import pytest
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

from utils.ai_reviewer import enrich_jobs, _FALLBACK


# ---------------------------------------------------------------------------
# Helper to make asyncio.to_thread call the function directly in tests
# ---------------------------------------------------------------------------
async def _fake_to_thread(func, *args, **kwargs):
    return func(*args, **kwargs)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_enrich_jobs_empty_list():
    """Empty input returns empty list."""
    result = await enrich_jobs([])
    assert result == []


@pytest.mark.asyncio
async def test_enrich_jobs_no_api_key(sample_job_dicts, mock_env_vars):
    """When GEMINI_API_KEY is missing, fallback values are applied."""
    mock_env_vars.unset("GEMINI_API_KEY")
    jobs = [sample_job_dicts[0].copy()]
    result = await enrich_jobs(jobs)

    assert result[0]["rating"] == _FALLBACK["rating"]
    # original location should be preserved
    assert result[0]["location"] == sample_job_dicts[0]["location"]
    assert result[0]["experience"] == _FALLBACK["experience"]
    assert result[0]["salary"] == _FALLBACK["salary"]


@pytest.mark.asyncio
async def test_enrich_jobs_success(sample_job_dicts, mock_genai_client, mock_env_vars, mocker):
    """Happy path: Gemini returns valid JSON and fields are enriched."""
    mock_env_vars.set(GEMINI_API_KEY="test-key")
    mocker.patch("asyncio.to_thread", side_effect=_fake_to_thread)

    jobs = [sample_job_dicts[0].copy()]
    result = await enrich_jobs(jobs)

    assert result[0]["rating"] == 4
    assert result[0]["location"] == "Bengaluru"
    assert result[0]["experience"] == "3-5 Yrs"
    assert result[0]["salary"] == "₹12-18 LPA"


@pytest.mark.asyncio
async def test_enrich_jobs_model_fallback(sample_job_dicts, mock_genai_client, mock_env_vars, mocker):
    """First model returns 429, second model succeeds."""
    mock_env_vars.set(GEMINI_API_KEY="test-key")
    mocker.patch("asyncio.to_thread", side_effect=_fake_to_thread)

    def generate_side_effect(*args, **kwargs):
        model = kwargs.get("model")
        if model == "gemini-3.5-flash-lite":
            raise Exception("429 RESOURCE_EXHAUSTED")
        # second model succeeds
        resp = MagicMock()
        resp.text = '{"rating": 5, "location": "Remote", "experience": "5+ Yrs", "salary": "₹20 LPA"}'
        return resp

    mock_genai_client.models.generate_content.side_effect = generate_side_effect

    jobs = [sample_job_dicts[0].copy()]
    result = await enrich_jobs(jobs)

    assert result[0]["rating"] == 5
    assert result[0]["location"] == "Remote"
    assert result[0]["experience"] == "5+ Yrs"
    assert result[0]["salary"] == "₹20 LPA"


@pytest.mark.asyncio
async def test_enrich_jobs_malformed_json(sample_job_dicts, mock_genai_client, mock_env_vars, mocker):
    """Malformed JSON response triggers fallback."""
    mock_env_vars.set(GEMINI_API_KEY="test-key")
    mocker.patch("asyncio.to_thread", side_effect=_fake_to_thread)

    mock_genai_client.models.generate_content.return_value.text = "not valid json"

    jobs = [sample_job_dicts[0].copy()]
    result = await enrich_jobs(jobs)

    assert result[0]["rating"] == _FALLBACK["rating"]
    assert result[0]["location"] == sample_job_dicts[0]["location"]
    assert result[0]["experience"] == _FALLBACK["experience"]
    assert result[0]["salary"] == _FALLBACK["salary"]


@pytest.mark.asyncio
async def test_enrich_jobs_rating_clamping(sample_job_dicts, mock_genai_client, mock_env_vars, mocker):
    """Rating values outside 1-5 are clamped."""
    mock_env_vars.set(GEMINI_API_KEY="test-key")
    mocker.patch("asyncio.to_thread", side_effect=_fake_to_thread)

    # rating 0 → clamped to 1
    mock_genai_client.models.generate_content.return_value.text = (
        '{"rating": 0, "location": "Mumbai", "experience": "1-3 Yrs", "salary": "₹5 LPA"}'
    )
    jobs = [sample_job_dicts[0].copy()]
    result = await enrich_jobs(jobs)
    assert result[0]["rating"] == 1

    # rating 6 → clamped to 5
    mock_genai_client.models.generate_content.return_value.text = (
        '{"rating": 6, "location": "Delhi", "experience": "5+ Yrs", "salary": "₹30 LPA"}'
    )
    result = await enrich_jobs([sample_job_dicts[0].copy()])
    assert result[0]["rating"] == 5


@pytest.mark.asyncio
async def test_enrich_jobs_all_models_fail(sample_job_dicts, mock_genai_client, mock_env_vars, mocker):
    """When every model raises an exception, fallback is applied."""
    mock_env_vars.set(GEMINI_API_KEY="test-key")
    mocker.patch("asyncio.to_thread", side_effect=_fake_to_thread)

    mock_genai_client.models.generate_content.side_effect = Exception("Some error")

    jobs = [sample_job_dicts[0].copy()]
    result = await enrich_jobs(jobs)

    assert result[0]["rating"] == _FALLBACK["rating"]
    assert result[0]["location"] == sample_job_dicts[0]["location"]
    assert result[0]["experience"] == _FALLBACK["experience"]
    assert result[0]["salary"] == _FALLBACK["salary"]


@pytest.mark.asyncio
async def test_enrich_jobs_multiple_jobs(sample_job_dicts, mock_genai_client, mock_env_vars, mocker):
    """Multiple jobs are enriched concurrently."""
    mock_env_vars.set(GEMINI_API_KEY="test-key")
    mocker.patch("asyncio.to_thread", side_effect=_fake_to_thread)

    jobs = [sample_job_dicts[0].copy(), sample_job_dicts[1].copy()]
    result = await enrich_jobs(jobs)

    assert len(result) == 2
    for job in result:
        assert "rating" in job
        assert "location" in job
        assert "experience" in job
        assert "salary" in job


@pytest.mark.asyncio
async def test_enrich_jobs_description_truncation(sample_job_dicts, mock_genai_client, mock_env_vars, mocker):
    """Long descriptions are truncated to 3000 characters before being sent to Gemini."""
    mock_env_vars.set(GEMINI_API_KEY="test-key")
    mocker.patch("asyncio.to_thread", side_effect=_fake_to_thread)

    long_desc = "A" * 5000
    job = sample_job_dicts[0].copy()
    job["description"] = long_desc

    # We'll capture the prompt passed to generate_content to verify truncation
    original_generate = mock_genai_client.models.generate_content
    captured_prompts = []

    def capture_side_effect(*args, **kwargs):
        captured_prompts.append(kwargs.get("contents", ""))
        resp = MagicMock()
        resp.text = '{"rating": 4, "location": "Bengaluru", "experience": "3-5 Yrs", "salary": "₹12-18 LPA"}'
        return resp

    mock_genai_client.models.generate_content.side_effect = capture_side_effect

    await enrich_jobs([job])

    assert len(captured_prompts) == 1
    prompt = captured_prompts[0]
    # The description inside the prompt should be at most 3000 chars
    assert len(long_desc) > 3000
    assert "A" * 3000 in prompt
    assert "A" * 3001 not in prompt
