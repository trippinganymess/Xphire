import pytest
from unittest.mock import patch, MagicMock

from workers.worker_schedule import schedule_jobs


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------
def test_schedule_jobs_adds_scrape_and_email_jobs():
    """schedule_jobs registers two background jobs (scrape + email)."""
    with patch("workers.worker_schedule.BackgroundScheduler") as MockScheduler:
        mock_scheduler = MockScheduler.return_value

        schedule_jobs()

        assert mock_scheduler.add_job.call_count == 2

        calls = mock_scheduler.add_job.call_args_list
        # First job should be the scrape worker
        assert calls[0][1]["func"].__name__ == "run_scrape_worker"
        # Second job should be the email worker
        assert calls[1][1]["func"].__name__ == "run_email_worker"


def test_schedule_jobs_starts_scheduler():
    """The scheduler is started after jobs are added."""
    with patch("workers.worker_schedule.BackgroundScheduler") as MockScheduler:
        mock_scheduler = MockScheduler.return_value

        schedule_jobs()

        mock_scheduler.start.assert_called_once()


def test_schedule_jobs_already_running_does_not_add_jobs():
    """If the scheduler is already running, no duplicate jobs are added."""
    with patch("workers.worker_schedule.BackgroundScheduler") as MockScheduler:
        mock_scheduler = MockScheduler.return_value
        mock_scheduler.running = True

        schedule_jobs()

        mock_scheduler.add_job.assert_not_called()


def test_schedule_jobs_start_error_is_logged(caplog):
    """If scheduler.start() raises, the error is logged."""
    with patch("workers.worker_schedule.BackgroundScheduler") as MockScheduler:
        mock_scheduler = MockScheduler.return_value
        mock_scheduler.start.side_effect = Exception("Start failed")

        schedule_jobs()

        assert "Start failed" in caplog.text
