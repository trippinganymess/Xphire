import pytest
import os
from unittest.mock import patch, AsyncMock, MagicMock
import pandas as pd

from workers.worker_scrape import (
    get_keywords,
    scrape_keyword,
    main,
    DEFAULT_KEYWORDS,
)


# ---------------------------------------------------------------------------
# Tests for get_keywords
# ---------------------------------------------------------------------------
def test_get_keywords_returns_default_when_env_not_set(mock_env_vars):
    mock_env_vars.unset("SCRAPE_KEYWORDS")
    result = get_keywords()
    assert result == DEFAULT_KEYWORDS


def test_get_keywords_returns_parsed_list_when_env_set(mock_env_vars):
    mock_env_vars.set(SCRAPE_KEYWORDS="engineer, developer")
    result = get_keywords()
    assert result == ["engineer", "developer"]


# ---------------------------------------------------------------------------
# Tests for scrape_keyword
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_scrape_keyword_returns_empty_list(mock_httpx_client):
    result = await scrape_keyword("test", mock_httpx_client)
    assert result == []


# ---------------------------------------------------------------------------
# Tests for main
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_main_scrapes_and_processes(
    mock_httpx_client, mock_genai_client, mock_env_vars, sample_job_dicts
):
    mock_env_vars.set(GEMINI_API_KEY="test-key")
    with patch("workers.worker_scrape.scrape_keyword") as mock_scrape_kw:
        mock_scrape_kw.return_value = sample_job_dicts
        with patch("workers.worker_scrape.Deduper") as MockDeduper:
            deduper_instance = MockDeduper.return_value
            deduper_instance.get_unseen_jobs = AsyncMock(return_value=sample_job_dicts)
            deduper_instance.save_seen_jobs = AsyncMock()
            with patch("workers.worker_scrape.enrich_jobs") as mock_enrich:
                mock_enrich.return_value = sample_job_dicts
                with patch("workers.worker_scrape.httpx.AsyncClient") as mock_client_class:
                    mock_client_class.return_value.__aenter__.return_value = mock_httpx_client
                    await main()
                # Ensure scrape_keyword was called for each default keyword
                assert mock_scrape_kw.call_count == len(DEFAULT_KEYWORDS)
                deduper_instance.get_unseen_jobs.assert_called_once()
                mock_enrich.assert_called_once_with(sample_job_dicts)
                deduper_instance.save_seen_jobs.assert_called_once_with(
                    mock_httpx_client, sample_job_dicts
                )
