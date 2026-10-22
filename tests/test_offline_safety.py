import asyncio
import smtplib
import socket
import urllib.request

import httpx
import jobspy
import pytest
import requests
from google import genai

from utils import ai_reviewer, scraping
from utils.deduper import Deduper
from utils.emailer import send_email
from workers import worker_email


@pytest.mark.parametrize("effect", [
    lambda: socket.getaddrinfo("example.invalid", 443),
    lambda: socket.create_connection(("example.invalid", 443)),
    lambda: httpx.get("https://example.invalid"),
    lambda: requests.get("https://example.invalid"),
    lambda: urllib.request.urlopen("https://example.invalid"),
    lambda: genai.Client(api_key="not-a-real-key"),
    lambda: smtplib.SMTP_SSL("smtp.invalid", 465),
    lambda: smtplib.SMTP("smtp.invalid", 587),
    lambda: jobspy.scrape_jobs(site_name=["indeed"]),
])
def test_unscripted_effects_fail_closed(effect):
    with pytest.raises(pytest.fail.Exception, match="blocked by offline tests"):
        effect()


async def test_async_http_fails_instead_of_being_swallowed_by_collector(monkeypatch):
    for name in ("GREENHOUSE_SLUGS", "LEVER_SLUGS", "ASHBY_SLUGS", "SMARTRECRUITERS_SLUGS"):
        monkeypatch.setattr(scraping, name, ["offline"] if name == "GREENHOUSE_SLUGS" else [])
    async with httpx.AsyncClient() as client:
        with pytest.raises(pytest.fail.Exception, match="blocked by offline tests"):
            await scraping.scrape_ats(client, "Software Engineer")


async def test_unconfigured_jobspy_fails_instead_of_being_swallowed():
    with pytest.raises(pytest.fail.Exception, match="blocked by offline tests"):
        await scraping.scrape_jobspy("Software Engineer", None)


async def test_mock_transport_rejects_unscripted_urls(http_effects):
    with pytest.raises(pytest.fail.Exception, match="Unscripted HTTP"):
        await http_effects.client().get("https://database.invalid/unexpected")


async def test_ambient_credentials_do_not_enable_effects():
    deduper = Deduper()
    assert deduper.supabase_url is None
    assert deduper.supabase_key is None
    jobs = [{"company": "Acme", "title": "Junior Engineer", "location": "Pune"}]
    assert await ai_reviewer.enrich_jobs(jobs) is jobs
    assert await worker_email.check_db_cache(None, "Engineer") == []
    send_email("<p>offline</p>", "Offline", "recipient@example.invalid")
    assert jobs[0]["location"] == "Pune"


def test_runtime_dependencies_are_real_packages():
    assert callable(httpx.MockTransport)
    assert ai_reviewer._GENERATION_CONFIG.response_mime_type == "application/json"
    assert ai_reviewer._GENERATION_CONFIG.temperature == 0.1
    assert jobspy.__file__.endswith("__init__.py")


async def test_asyncio_socketpair_and_threads_still_work():
    assert await asyncio.to_thread(lambda: 42) == 42
