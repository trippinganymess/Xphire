import pytest
import hashlib
from unittest.mock import AsyncMock, MagicMock, patch

from utils.deduper import Deduper


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------
@pytest.fixture
def deduper_instance(mock_supabase_env):
    """Create a Deduper instance with mocked Supabase env vars."""
    return Deduper()


# ---------------------------------------------------------------------------
# generate_job_id
# ---------------------------------------------------------------------------
def test_generate_job_id_deterministic(deduper_instance):
    """Same inputs produce the same hash."""
    id1 = deduper_instance.generate_job_id("Acme", "Engineer", "http://a.com")
    id2 = deduper_instance.generate_job_id("Acme", "Engineer", "http://a.com")
    assert id1 == id2
    assert len(id1) == 32


def test_generate_job_id_case_insensitive(deduper_instance):
    """Company and title are lowercased before hashing."""
    id1 = deduper_instance.generate_job_id("ACME", "Engineer", "http://a.com")
    id2 = deduper_instance.generate_job_id("acme", "engineer", "http://a.com")
    assert id1 == id2


def test_generate_job_id_different_urls(deduper_instance):
    """Different URLs produce different hashes."""
    id1 = deduper_instance.generate_job_id("Acme", "Engineer", "http://a.com")
    id2 = deduper_instance.generate_job_id("Acme", "Engineer", "http://b.com")
    assert id1 != id2


# ---------------------------------------------------------------------------
# _inject_ids
# ---------------------------------------------------------------------------
def test_inject_ids_adds_missing(deduper_instance):
    jobs = [{"company": "A", "title": "B", "url": "http://c.com"}]
    result = deduper_instance._inject_ids(jobs)
    assert "job_id" in result[0]
    assert result[0]["job_id"] == deduper_instance.generate_job_id("A", "B", "http://c.com")


def test_inject_ids_preserves_existing(deduper_instance):
    jobs = [{"job_id": "existing", "company": "A", "title": "B", "url": "http://c.com"}]
    result = deduper_instance._inject_ids(jobs)
    assert result[0]["job_id"] == "existing"


# ---------------------------------------------------------------------------
# get_unseen_jobs
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_get_unseen_jobs_empty_list(deduper_instance, mock_httpx_client):
    """Empty scraped list returns empty."""
    result = await deduper_instance.get_unseen_jobs(mock_httpx_client, [])
    assert result == []


@pytest.mark.asyncio
async def test_get_unseen_jobs_missing_credentials(monkeypatch, mock_httpx_client):
    """When Supabase URL or key is missing, all jobs are returned as new."""
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_KEY", raising=False)
    deduper = Deduper()
    jobs = [{"company": "A", "title": "B", "url": "http://c.com"}]
    result = await deduper.get_unseen_jobs(mock_httpx_client, jobs)
    assert len(result) == 1
    assert result[0]["company"] == "A"


@pytest.mark.asyncio
async def test_get_unseen_jobs_all_new(deduper_instance, mock_httpx_client):
    """Supabase returns no existing IDs → all jobs are new."""
    mock_httpx_client.get.return_value.status_code = 200
    mock_httpx_client.get.return_value.json.return_value = []  # no existing

    jobs = [
        {"company": "A", "title": "B", "url": "http://c.com"},
        {"company": "D", "title": "E", "url": "http://f.com"},
    ]
    result = await deduper_instance.get_unseen_jobs(mock_httpx_client, jobs)
    assert len(result) == 2


@pytest.mark.asyncio
async def test_get_unseen_jobs_partial_seen(deduper_instance, mock_httpx_client):
    """Supabase returns some existing IDs → only new jobs returned."""
    # We'll mock the response to return one existing job_id
    jobs = [
        {"company": "A", "title": "B", "url": "http://c.com"},
        {"company": "D", "title": "E", "url": "http://f.com"},
    ]
    # inject IDs
    jobs = deduper_instance._inject_ids(jobs)
    existing_id = jobs[0]["job_id"]

    # Mock the GET to return that ID
    mock_httpx_client.get.return_value.status_code = 200
    mock_httpx_client.get.return_value.json.return_value = [{"job_id": existing_id}]

    result = await deduper_instance.get_unseen_jobs(mock_httpx_client, jobs)
    assert len(result) == 1
    assert result[0]["job_id"] == jobs[1]["job_id"]


@pytest.mark.asyncio
async def test_get_unseen_jobs_network_error(deduper_instance, mock_httpx_client):
    """Network error during dedup → all jobs returned as new (graceful fallback)."""
    mock_httpx_client.get.side_effect = Exception("Connection error")

    jobs = [{"company": "A", "title": "B", "url": "http://c.com"}]
    result = await deduper_instance.get_unseen_jobs(mock_httpx_client, jobs)
    assert len(result) == 1


# ---------------------------------------------------------------------------
# save_seen_jobs
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_save_seen_jobs_empty_list(deduper_instance, mock_httpx_client):
    """Empty list does nothing."""
    await deduper_instance.save_seen_jobs(mock_httpx_client, [])
    mock_httpx_client.post.assert_not_called()


@pytest.mark.asyncio
async def test_save_seen_jobs_missing_credentials(monkeypatch, mock_httpx_client):
    """Missing Supabase credentials → no POST."""
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_KEY", raising=False)
    deduper = Deduper()
    jobs = [{"job_id": "abc", "company": "A", "title": "B", "url": "http://c.com"}]
    await deduper.save_seen_jobs(mock_httpx_client, jobs)
    mock_httpx_client.post.assert_not_called()


@pytest.mark.asyncio
async def test_save_seen_jobs_success(deduper_instance, mock_httpx_client):
    """Successful save with enriched payload."""
    mock_httpx_client.post.return_value.status_code = 201

    jobs = [
        {
            "job_id": "abc",
            "company": "Acme",
            "title": "Engineer",
            "url": "http://a.com",
            "location": "Remote",
            "experience": "3-5 Yrs",
            "salary": "₹12 LPA",
            "source": "LinkedIn",
            "rating": 4,
        }
    ]
    await deduper_instance.save_seen_jobs(mock_httpx_client, jobs)
    assert mock_httpx_client.post.called


@pytest.mark.asyncio
async def test_save_seen_jobs_minimal_schema_fallback(deduper_instance, mock_httpx_client):
    """When Supabase returns 400 with PGRST204, fallback to minimal job_id payload."""
    # First POST returns 400 with PGRST204
    mock_httpx_client.post.return_value.status_code = 400
    mock_httpx_client.post.return_value.text = "PGRST204"

    jobs = [
        {
            "job_id": "abc",
            "company": "Acme",
            "title": "Engineer",
            "url": "http://a.com",
            "location": "Remote",
            "experience": "3-5 Yrs",
            "salary": "₹12 LPA",
            "source": "LinkedIn",
            "rating": 4,
        }
    ]
    await deduper_instance.save_seen_jobs(mock_httpx_client, jobs)

    # Should have called POST twice: first with full payload, second with minimal
    assert mock_httpx_client.post.call_count == 2
    # The second call should have only job_id
    second_call_args = mock_httpx_client.post.call_args_list[1]
    payload = second_call_args[1]["json"]
    assert len(payload) == 1
    assert payload[0] == {"job_id": "abc"}


@pytest.mark.asyncio
async def test_save_seen_jobs_network_error(deduper_instance, mock_httpx_client):
    """Network error during save is caught and logged (no crash)."""
    mock_httpx_client.post.side_effect = Exception("Network down")

    jobs = [{"job_id": "abc", "company": "A", "title": "B", "url": "http://c.com"}]
    # Should not raise
    await deduper_instance.save_seen_jobs(mock_httpx_client, jobs)
