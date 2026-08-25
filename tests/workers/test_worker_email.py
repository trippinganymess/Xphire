import pytest
from unittest.mock import patch, AsyncMock, MagicMock

from workers.worker_email import run_email_worker


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_run_email_worker_sends_emails(mock_smtp, mock_env_vars, sample_job_dicts):
    """When jobs are available, send_email is called for each job."""
    mock_env_vars.set(
        SMTP_HOST="smtp.example.com",
        SMTP_PORT="587",
        SMTP_USER="user@example.com",
        SMTP_PASS="secret",
    )

    with patch("workers.worker_email.send_email") as mock_send:
        with patch("workers.worker_email.Deduper") as MockDeduper:
            instance = MockDeduper.return_value
            instance.get_unseen_jobs = AsyncMock(return_value=sample_job_dicts)

            await run_email_worker()

            assert mock_send.call_count == len(sample_job_dicts)
            # Each call should include the job title in the subject
            for job in sample_job_dicts:
                mock_send.assert_any_call(
                    to="user@example.com",  # default recipient
                    subject=f"New Job: {job['title']}",
                    body=job["description"],
                )


@pytest.mark.asyncio
async def test_run_email_worker_no_jobs(mock_smtp, mock_env_vars):
    """When no unseen jobs exist, no email is sent."""
    mock_env_vars.set(
        SMTP_HOST="smtp.example.com",
        SMTP_PORT="587",
        SMTP_USER="user@example.com",
        SMTP_PASS="secret",
    )

    with patch("workers.worker_email.send_email") as mock_send:
        with patch("workers.worker_email.Deduper") as MockDeduper:
            instance = MockDeduper.return_value
            instance.get_unseen_jobs = AsyncMock(return_value=[])

            await run_email_worker()

            mock_send.assert_not_called()


@pytest.mark.asyncio
async def test_run_email_worker_send_error(mock_smtp, mock_env_vars, sample_job_dicts, caplog):
    """If send_email raises, the error is logged and processing continues."""
    mock_env_vars.set(
        SMTP_HOST="smtp.example.com",
        SMTP_PORT="587",
        SMTP_USER="user@example.com",
        SMTP_PASS="secret",
    )

    with patch("workers.worker_email.send_email", side_effect=Exception("Send failed")) as mock_send:
        with patch("workers.worker_email.Deduper") as MockDeduper:
            instance = MockDeduper.return_value
            instance.get_unseen_jobs = AsyncMock(return_value=sample_job_dicts)

            await run_email_worker()

            # Should have attempted to send for every job
            assert mock_send.call_count == len(sample_job_dicts)
            assert "Send failed" in caplog.text


@pytest.mark.asyncio
async def test_run_email_worker_missing_smtp_config(mock_smtp, mock_env_vars, sample_job_dicts, caplog):
    """Missing SMTP configuration is logged and no emails are sent."""
    mock_env_vars.unset("SMTP_HOST")

    with patch("workers.worker_email.send_email") as mock_send:
        with patch("workers.worker_email.Deduper") as MockDeduper:
            instance = MockDeduper.return_value
            instance.get_unseen_jobs = AsyncMock(return_value=sample_job_dicts)

            await run_email_worker()

            mock_send.assert_not_called()
            assert "SMTP_HOST" in caplog.text
