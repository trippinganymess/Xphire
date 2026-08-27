import pytest
from unittest.mock import patch, MagicMock
from datetime import datetime, timezone, timedelta

from workers.worker_email import (
    is_fresher_job,
    _is_relevant_ats_job,
    _hours_ago_iso,
)


# ---------------------------------------------------------------------------
# Tests for is_fresher_job
# ---------------------------------------------------------------------------
def test_is_fresher_job_true_for_intern_title():
    job = {"title": "Software Engineer Intern", "experience": "", "description": ""}
    assert is_fresher_job(job) is True


def test_is_fresher_job_false_for_senior():
    job = {"title": "Senior Developer", "experience": "5+ years", "description": ""}
    assert is_fresher_job(job) is False


def test_is_fresher_job_true_for_experience_fresher():
    job = {"title": "Developer", "experience": "0-1 years", "description": ""}
    assert is_fresher_job(job) is True


def test_is_fresher_job_true_for_description_fresher():
    job = {"title": "Developer", "experience": "", "description": "entry-level position"}
    assert is_fresher_job(job) is True


def test_is_fresher_job_false_for_no_match():
    job = {"title": "Manager", "experience": "10+ years", "description": "leadership role"}
    assert is_fresher_job(job) is False


# ---------------------------------------------------------------------------
# Tests for _is_relevant_ats_job
# ---------------------------------------------------------------------------
def test__is_relevant_ats_job_true_for_india_location_and_tech_title():
    assert _is_relevant_ats_job(
        title="Software Engineer",
        location="Bengaluru",
        search_title="engineer",
        freshers_only=False,
    ) is True


def test__is_relevant_ats_job_false_for_non_india_location():
    assert _is_relevant_ats_job(
        title="Software Engineer",
        location="New York",
        search_title="engineer",
        freshers_only=False,
    ) is False


def test__is_relevant_ats_job_false_for_non_tech_title():
    assert _is_relevant_ats_job(
        title="Manager",
        location="India",
        search_title="engineer",
        freshers_only=False,
    ) is False


def test__is_relevant_ats_job_freshers_only_true_with_fresher_title():
    assert _is_relevant_ats_job(
        title="Junior Developer",
        location="India",
        search_title="developer",
        freshers_only=True,
    ) is True


def test__is_relevant_ats_job_freshers_only_false_without_fresher_title():
    assert _is_relevant_ats_job(
        title="Senior Developer",
        location="India",
        search_title="developer",
        freshers_only=True,
    ) is False


# ---------------------------------------------------------------------------
# Tests for _hours_ago_iso
# ---------------------------------------------------------------------------
def test__hours_ago_iso_returns_correct_format():
    result = _hours_ago_iso(6)
    assert isinstance(result, str)
    dt = datetime.fromisoformat(result)
    now = datetime.now(timezone.utc)
    delta = now - dt
    # Should be roughly 6 hours ago (allow 5 seconds tolerance)
    assert abs(delta.total_seconds() - 6 * 3600) < 5
