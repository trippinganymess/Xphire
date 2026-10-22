import httpx

from utils.ai_reviewer import _extract_retry_delay


def test_extract_retry_delay_from_sdk_error_text():
    exc = RuntimeError("429 RESOURCE_EXHAUSTED {'details': [{'retryDelay': '7s'}]}")
    assert _extract_retry_delay(exc) == 7.0


async def test_save_seen_jobs_deduplicates_last_record_wins(supabase, http_effects, clock):
    payloads = []

    def save(request):
        import json
        payloads.append(json.loads(request.content))
        return httpx.Response(201)

    http_effects.add("POST", "https://database.invalid/rest/v1/Seen_job", save)
    jobs = [
        {"job_id": "same", "company": "Acme", "title": "Old", "rating": 2},
        {"job_id": "other", "company": "Beta", "title": "One"},
        {"job_id": "same", "company": "Acme", "title": "Latest", "rating": 5},
    ]

    await supabase.save_seen_jobs(http_effects.client(), jobs)

    records = payloads[0]
    assert [record["job_id"] for record in records] == ["same", "other"]
    assert next(record for record in records if record["job_id"] == "same")["title"] == "Latest"
