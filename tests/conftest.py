import os
import asyncio
import pytest
import pandas as pd
from unittest.mock import AsyncMock, MagicMock, patch

# ---------------------------------------------------------------------------
# Fixture: sample job dicts (used across many tests)
# ---------------------------------------------------------------------------
@pytest.fixture
def sample_job_dicts():
    return [
        {
            "job_id": "abc123",
            "company": "Acme Corp",
            "title": "Software Engineer",
            "url": "https://example.com/job/1",
            "location": "Bengaluru",
            "description": "Build great things.",
            "source": "LinkedIn",
            "salary": "₹12,00,000 - ₹18,00,000 / yr",
            "rating": 4,
            "experience": "3-5 Yrs",
        },
        {
            "job_id": "def456",
            "company": "Beta Startup",
            "title": "Frontend Developer",
            "url": "https://example.com/job/2",
            "location": "Remote",
            "description": "React and TypeScript.",
            "source": "Indeed",
            "salary": "Not Disclosed",
            "rating": 3,
            "experience": "Fresher / 0-1 Yrs",
        },
    ]


# ---------------------------------------------------------------------------
# Fixture: sample DataFrame (mimics JobSpy output)
# ---------------------------------------------------------------------------
@pytest.fixture
def sample_dataframe():
    return pd.DataFrame(
        [
            {
                "id": "abc123",
                "company": "Acme Corp",
                "title": "Software Engineer",
                "job_url": "https://example.com/job/1",
                "location": "Bengaluru",
                "description": "Build great things.",
                "site": "linkedin",
                "min_amount": 1200000,
                "max_amount": 1800000,
                "currency": "INR",
            },
            {
                "id": "def456",
                "company": "Beta Startup",
                "title": "Frontend Developer",
                "job_url": "https://example.com/job/2",
                "location": "Remote",
                "description": "React and TypeScript.",
                "site": "indeed",
                "min_amount": None,
                "max_amount": None,
                "currency": None,
            },
        ]
    )


# ---------------------------------------------------------------------------
# Fixture: mock httpx.AsyncClient
# ---------------------------------------------------------------------------
@pytest.fixture
def mock_httpx_client(mocker):
    client = AsyncMock()
    # Default response for GET/POST can be overridden in individual tests
    client.get.return_value.status_code = 200
    client.get.return_value.json.return_value = []
    client.post.return_value.status_code = 201
    client.post.return_value.json.return_value = {}
    return client


# ---------------------------------------------------------------------------
# Fixture: mock Supabase environment variables
# ---------------------------------------------------------------------------
@pytest.fixture
def mock_supabase_env(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_KEY", "anon-key")
    monkeypatch.setenv("SUPABASE_SERVICE_KEY", "service-role-key")


# ---------------------------------------------------------------------------
# Fixture: mock SMTP (prevents real email sending)
# ---------------------------------------------------------------------------
@pytest.fixture
def mock_smtp(mocker):
    mock_ssl = mocker.patch("smtplib.SMTP_SSL", autospec=True)
    mock_smtp = mocker.patch("smtplib.SMTP", autospec=True)
    return mock_ssl, mock_smtp


# ---------------------------------------------------------------------------
# Fixture: mock Gemini AI client
# ---------------------------------------------------------------------------
@pytest.fixture
def mock_genai_client(mocker):
    mock_client = MagicMock()
    mock_models = MagicMock()
    mock_client.models = mock_models
    # Default generate_content returns a valid JSON string
    mock_response = MagicMock()
    mock_response.text = '{"rating": 4, "location": "Bengaluru", "experience": "3-5 Yrs", "salary": "₹12-18 LPA"}'
    mock_models.generate_content.return_value = mock_response
    mocker.patch("google.genai.Client", return_value=mock_client)
    return mock_client


# ---------------------------------------------------------------------------
# Fixture: mock environment variables helper (set/unset)
# ---------------------------------------------------------------------------
@pytest.fixture
def mock_env_vars(monkeypatch):
    """Provides a helper to set/unset environment variables in tests."""
    class EnvHelper:
        def set(self, **kwargs):
            for k, v in kwargs.items():
                monkeypatch.setenv(k, v)

        def unset(self, *keys):
            for k in keys:
                monkeypatch.delenv(k, raising=False)

    return EnvHelper()


# ---------------------------------------------------------------------------
# Configure pytest-asyncio to auto-detect async tests
# ---------------------------------------------------------------------------
def pytest_configure(config):
    config.option.asyncio_mode = "auto"
