import pytest
import pandas as pd
from unittest.mock import patch, AsyncMock, MagicMock

from workers.worker_scrape import run_scrape_worker


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_run_scrape_worker_success(
    mock_httpx_client, mock_genai_client, mock_env_vars, sample_dataframe, sample_job_dicts
):
    """Happy path: scrape → dedup → enrich → save."""
    mock_env_vars.set(GEMINI_API_KEY="test-key")

    with patch("workers.worker_scrape.scrape_jobs") as mock_scrape:
        mock_scrape.return_value = sample_dataframe

        with patch("workers.worker_scrape.Deduper") as MockDeduper:
            deduper_instance = MockDeduper.return_value
            deduper_instance.get_unseen_jobs = AsyncMock(return_value=sample_job_dicts)
            deduper_instance.save_seen_jobs = AsyncMock()

            with patch("workers.worker_scrape.enrich_jobs") as mock_enrich:
                mock_enrich.return_value = sample_job_dicts

                await run_scrape_worker()

                mock_scrape.assert_called_once()
                deduper_instance.get_unseen_jobs.assert_called_once()
                mock_enrich.assert_called_once_with(sample_job_dicts)
                deduper_instance.save_seen_jobs.assert_called_once_with(
                    mock_httpx_client, sample_job_dicts
                )


@pytest.mark.asyncio
async def test_run_scrape_worker_empty_scrape(
    mock_httpx_client, mock_genai_client, mock_env_vars
):
    """When scraping returns an empty DataFrame, no further steps are taken."""
    with patch("workers.worker_scrape.scrape_jobs") as mock_scrape:
        mock_scrape.return_value = pd.DataFrame()

        with patch("workers.worker_scrape.Deduper") as MockDeduper:
            deduper_instance = MockDeduper.return_value
            deduper_instance.get_unseen_jobs = AsyncMock()

            await run_scrape_worker()

            deduper_instance.get_unseen_jobs.assert_not_called()


@pytest.mark.asyncio
async def test_run_scrape_worker_no_new_jobs(
    mock_httpx_client, mock_genai_client, mock_env_vars, sample_dataframe
):
    """When dedup returns no unseen jobs, enrichment and save are skipped."""
    with patch("workers.worker_scrape.scrape_jobs") as mock_scrape:
        mock_scrape.return_value = sample_dataframe

        with patch("workers.worker_scrape.Deduper") as MockDeduper:
            deduper_instance = MockDeduper.return_value
            deduper_instance.get_unseen_jobs = AsyncMock(return_value=[])

            with patch("workers.worker_scrape.enrich_jobs") as mock_enrich:
                await run_scrape_worker()

                mock_enrich.assert_not_called()
                deduper_instance.save_seen_jobs.assert_not_called()


@pytest.mark.asyncio
async def test_run_scrape_worker_enrich_fallback(
    mock_httpx_client, mock_genai_client, mock_env_vars, sample_dataframe, sample_job_dicts
):
    """Even when enrichment returns fallback values, jobs are still saved."""
    mock_env_vars.set(GEMINI_API_KEY="test-key")

    fallback_jobs = [
        {
            **job,
            "rating": 3,
            "location": job.get("location", "Unknown"),
            "experience": "N/A",
            "salary": "N/A",
        }
        for job in sample_job_dicts
    ]

    with patch("workers.worker_scrape.scrape_jobs") as mock_scrape:
        mock_scrape.return_value = sample_dataframe

        with patch("workers.worker_scrape.Deduper") as MockDeduper:
            deduper_instance = MockDeduper.return_value
            deduper_instance.get_unseen_jobs = AsyncMock(return_value=sample_job_dicts)
            deduper_instance.save_seen_jobs = AsyncMock()

            with patch("workers.worker_scrape.enrich_jobs") as mock_enrich:
                mock_enrich.return_value = fallback_jobs

                await run_scrape_worker()

                deduper_instance.save_seen_jobs.assert_called_once_with(
                    mock_httpx_client, fallback_jobs
                )


@pytest.mark.asyncio
async def test_run_scrape_worker_save_error(
    mock_httpx_client, mock_genai_client, mock_env_vars, sample_dataframe, sample_job_dicts, caplog
):
    """If save_seen_jobs raises, the error is logged and the worker does not crash."""
    mock_env_vars.set(GEMINI_API_KEY="test-key")

    with patch("workers.worker_scrape.scrape_jobs") as mock_scrape:
        mock_scrape.return_value = sample_dataframe

        with patch("workers.worker_scrape.Deduper") as MockDeduper:
            deduper_instance = MockDeduper.return_value
            deduper_instance.get_unseen_jobs = AsyncMock(return_value=sample_job_dicts)
            deduper_instance.save_seen_jobs = AsyncMock(side_effect=Exception("Save failed"))

            with patch("workers.worker_scrape.enrich_jobs") as mock_enrich:
                mock_enrich.return_value = sample_job_dicts

                await run_scrape_worker()

                assert "Save failed" in caplog.text


@pytest.mark.asyncio
async def test_run_scrape_worker_passes_site_and_search_term(
    mock_httpx_client, mock_genai_client, mock_env_vars, sample_dataframe, sample_job_dicts
):
    """The worker reads SITE and SEARCH_TERM from the environment."""
    mock_env_vars.set(GEMINI_API_KEY="test-key", SITE="indeed", SEARCH_TERM="python developer")

    with patch("workers.worker_scrape.scrape_jobs") as mock_scrape:
        mock_scrape.return_value = sample_dataframe

        with patch("workers.worker_scrape.Deduper") as MockDeduper:
            deduper_instance = MockDeduper.return_value
            deduper_instance.get_unseen_jobs = AsyncMock(return_value=sample_job_dicts)
            deduper_instance.save_seen_jobs = AsyncMock()

            with patch("workers.worker_scrape.enrich_jobs") as mock_enrich:
                mock_enrich.return_value = sample_job_dicts

                await run_scrape_worker()

                mock_scrape.assert_called_once_with(
                    site="indeed",
                    search_term="python developer",
                    location="India",
                    results_wanted=10,
                )
