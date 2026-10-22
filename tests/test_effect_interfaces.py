import json
import smtplib
from email import message_from_string

import httpx
import pytest

from utils import ai_reviewer
from utils.emailer import build_html_email, send_email
from workers import worker_email


async def test_model_enrichment_uses_installed_sdk_config_and_retains_order(model_effects):
    model_effects.outcomes.extend([
        json.dumps({"rating": 8, "location": "Pune", "experience": "0-2 Yrs", "salary": "INR 10 LPA"}),
        json.dumps({"rating": 4, "location": "India", "experience": "Intern", "salary": "Not Disclosed"}),
    ])
    jobs = [{"company": "Acme", "title": "Engineer", "description": "x" * 4000},
            {"company": "Beta", "title": "Intern"}]
    result = await ai_reviewer.enrich_jobs(jobs)
    assert [j["company"] for j in result] == ["Acme", "Beta"]
    assert result[0]["rating"] == 5
    assert result[0]["salary"] == "INR 10 LPA"
    assert len(model_effects.calls) == 2
    assert "x" * 3001 not in model_effects.calls[0]["contents"]
    assert model_effects.calls[0]["config"] is ai_reviewer._GENERATION_CONFIG


async def test_model_server_retry_delay_advances_fake_clock(model_effects, clock):
    model_effects.outcomes.extend([
        RuntimeError("429 RESOURCE_EXHAUSTED {'retryDelay': '7s'}"),
        json.dumps({"rating": 4, "location": "Pune"}),
    ])
    result = await ai_reviewer.enrich_jobs([{"company": "Acme", "title": "Intern"}])
    assert result[0]["rating"] == 4
    assert 8.0 in clock.sleeps
    assert len(model_effects.calls) == 2


async def test_bad_model_responses_fall_back_without_losing_source_location(model_effects):
    model_effects.outcomes.extend(["invalid json"] * 3)
    jobs = [{"company": "Acme", "title": "Intern", "location": "Kochi", "salary": "INR 20,000/mo"}]
    result = await ai_reviewer.enrich_jobs(jobs)
    assert result[0]["location"] == "Kochi"
    assert result[0]["salary"] == "INR 20,000/mo"
    assert result[0]["rating"] == 3
    assert len(model_effects.calls) == 3


async def test_supabase_reads_and_upserts_use_mock_transport_service_key_and_clock(supabase, http_effects, clock):
    http_effects.add("GET", "https://database.invalid/rest/v1/Seen_job",
                     httpx.Response(200, json=[{"job_id": "seen"}]))
    http_effects.add("POST", "https://database.invalid/rest/v1/Seen_job", httpx.Response(201))
    jobs = [{"job_id": "seen", "company": "Acme", "title": "Old"},
            {"job_id": "new", "company": "Acme", "title": "Intern", "location": "India"}]
    unseen = await supabase.get_unseen_jobs(http_effects.client(), jobs)
    assert [j["job_id"] for j in unseen] == ["new"]
    await supabase.save_seen_jobs(http_effects.client(), unseen)
    read, write = http_effects.requests
    assert read.headers["authorization"] == "Bearer offline-anon"
    assert write.headers["authorization"] == "Bearer offline-service"
    payload = json.loads(write.content)
    assert payload[0]["scraped_at"] == "2026-01-02T12:00:00Z"
    assert write.headers["prefer"] == "resolution=merge-duplicates"


async def test_cache_query_respects_rating_window_and_fresher_filter(supabase, http_effects, clock):
    rows = [{"title": "Intern", "experience": "0-2 Yrs", "rating": 4},
            {"title": "Senior Engineer", "experience": "5+ Yrs", "rating": 4}]
    http_effects.add("GET", "https://database.invalid/rest/v1/Seen_job", httpx.Response(200, json=rows))
    result = await worker_email.check_db_cache(http_effects.client(), "Engineer", freshers_only=True, min_stars=4)
    assert result == [rows[0]]
    query = http_effects.requests[0].url.params
    assert query["rating"] == "gte.4"
    assert query["scraped_at"] == "gte.2026-01-02T06:00:00Z"


@pytest.mark.xfail(strict=True, raises=AssertionError, reason="notes/10: rediscovery must refresh observation/lifecycle, not silently drop seen jobs")
async def test_lifecycle_rediscovery_reaches_catalog_update(supabase, http_effects):
    http_effects.add("GET", "https://database.invalid/rest/v1/Seen_job",
                     httpx.Response(200, json=[{"job_id": "seen"}]))
    observed = [{"job_id": "seen", "title": "Intern", "source": "Greenhouse"}]
    updates = await supabase.get_unseen_jobs(http_effects.client(), observed)
    assert updates == observed


@pytest.mark.parametrize("port", [465, 587])
def test_smtp_delivery_is_recorded_in_memory_with_tls(port, monkeypatch, smtp_effects):
    monkeypatch.setenv("SMTP_PORT", str(port))
    html = build_html_email([{"company": "Acme", "title": "Intern", "url": "https://jobs.invalid/1"}], "Intern")
    send_email(html, "Offline digest", "recipient@example.invalid")
    assert len(smtp_effects.messages) == 1
    sender, recipient, raw = smtp_effects.messages[0]
    assert (sender, recipient) == ("sender@example.invalid", "recipient@example.invalid")
    message = message_from_string(raw)
    assert message["Subject"] == "Offline digest"
    assert message.get_payload()[0].get_content_type() == "text/html"
    if port == 587:
        assert ("starttls",) in smtp_effects.events
    assert ("close",) in smtp_effects.events


def test_smtp_retry_exhaustion_propagates_without_real_sleep(smtp_effects, clock):
    smtp_effects.failures.extend([smtplib.SMTPServerDisconnected("offline")] * 3)
    with pytest.raises(smtplib.SMTPServerDisconnected):
        send_email("<p>offline</p>", "Offline", "recipient@example.invalid")
    assert clock.sleeps == [2, 4]
