import asyncio
import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

google_module = types.ModuleType("google")
genai_module = types.ModuleType("google.genai")
genai_module.Client = object
genai_module.types = types.SimpleNamespace(GenerateContentConfig=lambda **kwargs: kwargs)
google_module.genai = genai_module
sys.modules.setdefault("google", google_module)
sys.modules.setdefault("google.genai", genai_module)
sys.modules.setdefault("httpx", types.ModuleType("httpx"))

from utils.ai_reviewer import _extract_retry_delay
from utils.deduper import Deduper


def test_extract_retry_delay_from_sdk_error_text():
    exc = RuntimeError("429 RESOURCE_EXHAUSTED {'details': [{'retryDelay': '7s'}]}")
    assert _extract_retry_delay(exc) == 7.0


class _Response:
    status_code = 201
    text = ""


class _Client:
    def __init__(self):
        self.payloads = []

    async def post(self, url, headers, json, timeout):
        self.payloads.append(json)
        return _Response()


def test_save_seen_jobs_deduplicates_last_record_wins(monkeypatch):
    deduper = Deduper()
    monkeypatch.setattr(deduper, "supabase_url", "https://example.supabase.co")
    monkeypatch.setattr(deduper, "supabase_key", "key")
    client = _Client()
    jobs = [
        {"job_id": "same", "company": "Acme", "title": "Old", "rating": 2},
        {"job_id": "other", "company": "Beta", "title": "One"},
        {"job_id": "same", "company": "Acme", "title": "Latest", "rating": 5},
    ]

    asyncio.run(deduper.save_seen_jobs(client, jobs))

    records = client.payloads[0]
    assert [record["job_id"] for record in records] == ["same", "other"]
    assert next(record for record in records if record["job_id"] == "same")["title"] == "Latest"
