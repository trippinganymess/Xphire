import pytest
import pandas as pd
from unittest.mock import patch, MagicMock
import httpx

from jobspy import scrape_jobs
from utils.scraping import (
    create_stealth_client,
    build_google_search_term,
    filter_mass_recruiters,
    df_to_job_dicts,
    filter_df_by_unseen,
)


# ---------------------------------------------------------------------------
# Tests for create_stealth_client
# ---------------------------------------------------------------------------
def test_create_stealth_client_returns_async_client():
    client = create_stealth_client()
    assert isinstance(client, httpx.AsyncClient)
    headers = client.headers
    assert "User-Agent" in headers
    assert "Accept" in headers


# ---------------------------------------------------------------------------
# Tests for build_google_search_term
# ---------------------------------------------------------------------------
def test_build_google_search_term_default():
    result = build_google_search_term("engineer")
    assert result == "engineer jobs near India since yesterday"


def test_build_google_search_term_override():
    # No override configured, so default behaviour applies
    result = build_google_search_term("Software Engineer")
    assert result == "Software Engineer jobs near India since yesterday"


# ---------------------------------------------------------------------------
# Tests for filter_mass_recruiters
# ---------------------------------------------------------------------------
def test_filter_mass_recruiters_removes_blocked():
    df = pd.DataFrame({
        "company": ["TCS", "Infosys", "Google", "Wipro", "Accenture"],
        "title": ["a"] * 5,
    })
    filtered = filter_mass_recruiters(df)
    assert len(filtered) == 1
    assert filtered.iloc[0]["company"] == "Google"


# ---------------------------------------------------------------------------
# Tests for df_to_job_dicts
# ---------------------------------------------------------------------------
def test_df_to_job_dicts_creates_correct_schema():
    df = pd.DataFrame({
        "id": ["123"],
        "company": ["TestCo"],
        "title": ["Engineer"],
        "job_url": ["http://example.com"],
        "location": ["Remote"],
        "description": ["desc"],
        "site": ["indeed"],
        "min_amount": [50000],
        "max_amount": [70000],
        "currency": ["USD"],
    })
    result = df_to_job_dicts(df)
    assert len(result) == 1
    job = result[0]
    assert job["job_id"] == "123"
    assert job["company"] == "TestCo"
    assert job["title"] == "Engineer"
    assert job["url"] == "http://example.com"
    assert job["location"] == "Remote"
    assert job["description"] == "desc"
    assert job["source"] == "indeed"
    assert "USD" in job["salary"]


# ---------------------------------------------------------------------------
# Tests for filter_df_by_unseen
# ---------------------------------------------------------------------------
def test_filter_df_by_unseen_keeps_only_unseen_ids():
    df = pd.DataFrame({
        "id": [1, 2, 3],
        "title": ["a", "b", "c"],
    })
    unseen = {1, 3}
    result = filter_df_by_unseen(df, unseen)
    assert len(result) == 2
    assert set(result["id"]) == {1, 3}


# ---------------------------------------------------------------------------
# Tests for scrape_jobs (imported from jobspy)
# ---------------------------------------------------------------------------
def test_scrape_jobs_success(sample_dataframe):
    with patch("jobspy.scrape_jobs") as mock_scrape:
        mock_scrape.return_value = sample_dataframe

        result = scrape_jobs(
            site_name=["linkedin"],
            search_term="engineer",
            location="Bengaluru",
            results_wanted=10,
        )

        mock_scrape.assert_called_once_with(
            site_name=["linkedin"],
            search_term="engineer",
            location="Bengaluru",
            results_wanted=10,
        )
        assert isinstance(result, pd.DataFrame)
        assert len(result) == len(sample_dataframe)


def test_scrape_jobs_exception_raises():
    with patch("jobspy.scrape_jobs", side_effect=Exception("API error")):
        with pytest.raises(Exception, match="API error"):
            scrape_jobs(
                site_name=["linkedin"],
                search_term="engineer",
                location="Bengaluru",
                results_wanted=10,
            )
