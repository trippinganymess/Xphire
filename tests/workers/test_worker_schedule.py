import pytest
import os
from unittest.mock import patch, AsyncMock, MagicMock
import httpx

from workers.worker_schedule import (
    fetch_subscriptions,
    run_pipeline_for_subscription,
    main,
)


# ---------------------------------------------------------------------------
# Tests for fetch_subscriptions
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_fetch_subscriptions_returns_rows(mock_env_vars):
    mock_env_vars.set(SUPABASE_URL="https://example.supabase.co", SUPABASE_SERVICE_KEY="svc-key")
    with patch("httpx.AsyncClient.get") as mock_get:
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = [{"id": 1, "job_title": "Engineer"}]
        mock_get.return_value = mock_resp

        rows = await fetch_subscriptions(utc_hour=12)
        assert len(rows) == 1
        assert rows[0]["job_title"] == "Engineer"


@pytest.mark.asyncio
async def test_fetch_subscriptions_returns_empty_on_error(mock_env_vars):
    mock_env_vars.set(SUPABASE_URL="https://example.supabase.co", SUPABASE_SERVICE_KEY="svc-key")
    with patch("httpx.AsyncClient.get", side_effect=Exception("Network error")):
        rows = await fetch_subscriptions(utc_hour=12)
        assert rows == []


# ---------------------------------------------------------------------------
# Tests for run_pipeline_for_subscription
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_run_pipeline_for_subscription_sets_env_and_calls_email_main(mock_env_vars):
    sub = {
        "id": 1,
        "job_title": "Engineer",
        "recipient_email": "test@example.com",
        "freshers_only": True,
        "min_stars": 4,
    }
    with patch("workers.worker_schedule.email_main") as mock_email_main:
        mock_email_main.return_value = None  # async function
        await run_pipeline_for_subscription(sub)
        assert os.environ["JOB_TITLE"] == "Engineer"
        assert os.environ["RECIPIENT_EMAIL"] == "test@example.com"
        assert os.environ["FRESHERS_ONLY"] == "true"
        assert os.environ["MIN_STARS"] == "4"
        mock_email_main.assert_called_once()


# ---------------------------------------------------------------------------
# Tests for main
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_main_calls_fetch_and_run(mock_env_vars):
    mock_env_vars.set(SUPABASE_URL="https://example.supabase.co", SUPABASE_SERVICE_KEY="svc-key")
    with patch("workers.worker_schedule.fetch_subscriptions") as mock_fetch:
        mock_fetch.return_value = [{"id": 1, "job_title": "Engineer", "recipient_email": "a@b.com"}]
        with patch("workers.worker_schedule.run_pipeline_for_subscription") as mock_run:
            await main()
            mock_fetch.assert_called_once()
            mock_run.assert_called_once_with({"id": 1, "job_title": "Engineer", "recipient_email": "a@b.com"})
