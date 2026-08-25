import pytest
import pandas as pd
from unittest.mock import patch, MagicMock

from utils.scraping import scrape_jobs


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------
def test_scrape_jobs_success(sample_dataframe):
    """Happy path: jobspy returns a DataFrame and scrape_jobs forwards it."""
    with patch("utils.scraping.jobspy.scrape_jobs") as mock_scrape:
        mock_scrape.return_value = sample_dataframe

        result = scrape_jobs(
            site="linkedin",
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


def test_scrape_jobs_exception_returns_empty():
    """When jobspy raises an exception, an empty DataFrame is returned."""
    with patch("utils.scraping.jobspy.scrape_jobs", side_effect=Exception("API error")):
        result = scrape_jobs(
            site="linkedin",
            search_term="engineer",
            location="Bengaluru",
            results_wanted=10,
        )
        assert isinstance(result, pd.DataFrame)
        assert result.empty


def test_scrape_jobs_zero_results():
    """results_wanted=0 should skip the call and return an empty DataFrame."""
    with patch("utils.scraping.jobspy.scrape_jobs") as mock_scrape:
        result = scrape_jobs(
            site="linkedin",
            search_term="engineer",
            location="Bengaluru",
            results_wanted=0,
        )
        mock_scrape.assert_not_called()
        assert isinstance(result, pd.DataFrame)
        assert result.empty


def test_scrape_jobs_invalid_site():
    """An invalid site name raises ValueError."""
    with pytest.raises(ValueError, match="Invalid site"):
        scrape_jobs(
            site="invalid",
            search_term="engineer",
            location="Bengaluru",
            results_wanted=10,
        )
