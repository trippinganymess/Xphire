import httpx
import pandas as pd
import pytest

from utils.scraping import (
    df_to_job_dicts,
    filter_df_by_unseen,
    is_fresher_job,
    scrape_ats,
    scrape_jobspy,
)


@pytest.mark.parametrize(("job", "expected"), [
    ({"title": "Software Engineering Intern"}, True),
    ({"title": "Graduate Data Engineer"}, True),
    ({"experience": "Fresher / 0-1 Yrs"}, True),
    ({"experience": "0-2 Yrs"}, True),
    pytest.param({"experience": "10-12 Yrs", "title": "Software Engineer"}, False,
                 marks=pytest.mark.xfail(strict=True, raises=AssertionError, reason="notes/08: numeric experience must not match 0-1 substring")),
    ({"title": "Senior Engineer", "experience": "5+ Yrs"}, False),
    ({}, False),
])
def test_unambiguous_current_fresher_cases(job, expected):
    assert is_fresher_job(job) is expected


@pytest.fixture
def ats_board(monkeypatch, http_effects):
    """All four current collector response shapes, one explicitly allowed board each."""
    from utils import scraping

    boards = [
        ("GREENHOUSE_SLUGS", "Greenhouse", "https://boards-api.greenhouse.io/v1/boards/acme/jobs",
         lambda rows: {"jobs": [{"title": t, "location": {"name": loc}, "absolute_url": f"https://jobs.invalid/gh/{i}"} for i, (t, loc) in enumerate(rows)]}),
        ("LEVER_SLUGS", "Lever", "https://api.lever.co/v0/postings/acme",
         lambda rows: [{"text": t, "categories": {"location": loc}, "hostedUrl": f"https://jobs.invalid/lv/{i}"} for i, (t, loc) in enumerate(rows)]),
        ("ASHBY_SLUGS", "Ashby", "https://api.ashbyhq.com/gcs/v1/deb/organization/acme/job-board",
         lambda rows: {"jobs": [{"title": t, "locationName": loc, "jobUrl": f"https://jobs.invalid/ash/{i}"} for i, (t, loc) in enumerate(rows)]}),
        ("SMARTRECRUITERS_SLUGS", "SmartRecruiters", "https://api.smartrecruiters.com/v1/companies/acme/postings",
         lambda rows: {"content": [{"name": t, "location": {"city": loc}, "id": str(i)} for i, (t, loc) in enumerate(rows)]}),
    ]
    for name, _, _, _ in boards:
        monkeypatch.setattr(scraping, name, ["acme"])

    def load(rows, failed_source=None):
        for _, source, url, encode in boards:
            response = httpx.Response(503) if source == failed_source else httpx.Response(200, json=encode(rows))
            http_effects.add("GET", url, response)

    return load


async def test_public_ats_collectors_keep_safe_india_and_fresher_cases(ats_board, http_effects):
    ats_board([
        ("Junior Software Engineer", "Bengaluru"),
        ("Junior Software Engineer", "Pune, India"),
        ("Senior Software Engineer", "India"),
        ("Junior Software Engineer", "Berlin, Germany"),
        ("Junior Sales Representative", "India"),
    ])
    jobs = await scrape_ats(http_effects.client(), "Software Engineer", freshers_only=True)
    assert len(jobs) == 8
    assert {j["source"] for j in jobs} == {"Greenhouse", "Lever", "Ashby", "SmartRecruiters"}
    assert {j["location"] for j in jobs} == {"Bengaluru", "Pune, India"}
    assert all(j["company"] == "acme" and len(j["job_id"]) == 32 and j["url"] for j in jobs)


async def test_ats_source_failure_does_not_discard_other_sources(ats_board, http_effects):
    ats_board([("Junior Software Engineer", "India")], failed_source="Lever")
    jobs = await scrape_ats(http_effects.client(), "Software Engineer")
    assert {j["source"] for j in jobs} == {"Greenhouse", "Ashby", "SmartRecruiters"}


@pytest.mark.parametrize(("title", "location", "search", "expected_count"), [
    pytest.param("Junior Software Engineer", "Remote - United States", "Software Engineer", 0,
                 marks=pytest.mark.xfail(strict=True, raises=AssertionError, reason="notes/09: remote US is not India-allowed remote")),
    pytest.param("Junior Software Engineer", "", "Software Engineer", 0,
                 marks=pytest.mark.xfail(strict=True, raises=AssertionError, reason="notes/09: unknown location must not become India")),
    pytest.param("Junior Software Engineer", "Kochi", "Software Engineer", 4,
                 marks=pytest.mark.xfail(strict=True, raises=AssertionError, reason="notes/09: reliable non-default Indian cities must be retained")),
    pytest.param("Junior QA Analyst", "India", "Backend Developer", 0,
                 marks=pytest.mark.xfail(strict=True, raises=AssertionError, reason="notes/09: developer query must not bypass role-family mismatch")),
])
async def test_desired_location_and_role_contract(ats_board, http_effects, title, location, search, expected_count):
    ats_board([(title, location)])
    jobs = await scrape_ats(http_effects.client(), search, freshers_only=True)
    assert len(jobs) == expected_count


@pytest.mark.parametrize("job", [
    {"title": "Associate Software Engineer", "experience": "5+ Yrs", "description": "Minimum five years of professional experience required."},
    {"title": "Senior Software Engineer", "description": "Mentor junior engineers. Minimum 7 years required."},
    {"title": "Software Engineer", "description": "Not suitable for a fresher. Requires 5 years experience."},
])
@pytest.mark.xfail(strict=True, raises=AssertionError, reason="notes/08: mandatory experience/negation must override suggestive fresher keywords")
def test_desired_fresher_contract_rejects_mandatory_experience(job):
    assert not is_fresher_job(job)


@pytest.mark.xfail(strict=True, raises=AssertionError, reason="notes/08: explicit no-experience JD should retain generic titles")
def test_desired_fresher_contract_accepts_explicit_no_experience():
    assert is_fresher_job({"title": "Software Engineer", "description": "No professional experience required."})


def test_dataframe_bridge_preserves_source_and_salary():
    frame = pd.DataFrame([{"id": "job-1", "company": "Acme", "title": "Intern", "job_url": "https://jobs.invalid/1",
                           "location": "Pune", "description": "Paid internship", "site": "linkedin",
                           "currency": "inr", "min_amount": 800000, "max_amount": 1200000}])
    jobs = df_to_job_dicts(frame)
    assert jobs == [{"job_id": "job-1", "company": "Acme", "title": "Intern", "url": "https://jobs.invalid/1",
                     "location": "Pune", "description": "Paid internship", "source": "linkedin",
                     "salary": "INR 800,000 - 1,200,000 / yr"}]
    assert df_to_job_dicts(frame, source_override="custom")[0]["source"] == "custom"
    assert filter_df_by_unseen(frame, {"job-1"}).equals(frame)
    assert filter_df_by_unseen(frame, set()).empty


async def test_jobspy_boundary_merges_deduplicates_and_blocks_mass_recruiters(jobspy_effects):
    shared = {"id": "same", "company": "Acme", "title": "Intern", "job_url": "https://jobs.invalid/1", "site": "linkedin", "location": "Pune"}
    jobspy_effects.frames = {
        "linkedin": pd.DataFrame([shared, {**shared, "id": "blocked", "company": "Tata Consultancy Services"}]),
        "indeed": pd.DataFrame([shared, {**shared, "id": "other", "company": "Beta", "site": "indeed"}]),
    }
    jobs = await scrape_jobspy("Software Engineer", ["http://proxy.invalid"], freshers_only=True)
    assert [j["job_id"] for j in jobs] == ["same", "other"]
    assert all(call["location"] == "India" and call["search_term"] == "Software Engineer Fresher" for call in jobspy_effects.calls)
    assert all(call["proxies"] == ["http://proxy.invalid"] for call in jobspy_effects.calls)


async def test_jobspy_single_site_failure_returns_other_site(jobspy_effects):
    jobspy_effects.frames = {"linkedin": RuntimeError("fixture unavailable"), "indeed": pd.DataFrame([
        {"id": "ok", "title": "Intern", "company": "Acme", "job_url": "https://jobs.invalid/ok", "location": "India"}
    ])}
    assert [job["job_id"] for job in await scrape_jobspy("Intern", None)] == ["ok"]
