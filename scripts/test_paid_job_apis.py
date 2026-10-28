#!/usr/bin/env python3
"""Explicit, database-free TheirStack API gate. Never run from offline tests.

JSearch is deferred. The tentative normalizer proves response compatibility
only; results are not production-validated or persisted as private matches.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
from http.client import HTTPException
import json
import os
from pathlib import Path
import sys
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

THEIRSTACK_ENDPOINT = "https://api.theirstack.com/v1/jobs/search"
THEIRSTACK_BODY = {
    "job_title_or": ["frontend developer", "python developer"],
    "job_country_code_or": ["IN"],
    "posted_at_max_age_days": 1,
    "job_seniority_or": ["junior"],
    "employment_statuses_or": ["full_time", "internship"],
    "workplace_types_or": ["remote", "hybrid", "on_site"],
    "limit": 10,
    "page": 0,
}
TRACKING_PARAMETERS = {
    "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
    "source", "medium", "campaign", "referrer", "gclid", "fbclid",
}
# The combined RateLimit header can expose an account's partition identity.
RATE_HEADERS = {"ratelimit-limit", "ratelimit-remaining", "ratelimit-reset"}
SECRET_NAMES = ("THEIRSTACK_API_KEY", "THEIR_STACK_API_KEY")
MAX_RESPONSE_BYTES = 5 * 1024 * 1024


class NoRedirects(HTTPRedirectHandler):
    """Do not forward API credentials to a redirect destination."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def text(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    return " ".join(value.split()) or None


def number(value: Any) -> int | float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return value if value >= 0 and value < float("inf") else None


def clean_url(value: Any) -> str | None:
    candidate = text(value)
    if not candidate:
        return None
    try:
        parsed = urlsplit(candidate)
        if parsed.scheme not in {"https", "http"} or not parsed.hostname:
            return None
        if parsed.username or parsed.password:
            return None
        parsed.port  # Reject malformed ports during parsing.
        query = urlencode([
            (key, val) for key, val in parse_qsl(parsed.query, keep_blank_values=True)
            if key.casefold() not in TRACKING_PARAMETERS
        ])
        return urlunsplit((parsed.scheme.lower(), parsed.netloc.lower(), parsed.path, query, ""))
    except (ValueError, UnicodeError):
        return None


def timestamp(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            return None
        return parsed.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    except (ValueError, OverflowError):
        return None


def normalize_probe(job: dict[str, Any]) -> dict[str, Any]:
    """Build the proposed shape in memory; no eligibility or freshness claim."""
    company_object = job.get("company_object")
    company_object = company_object if isinstance(company_object, dict) else {}
    title = text(job.get("job_title"))
    if not title:
        raise ValueError("missing_title")
    company = text(job.get("company")) or text(company_object.get("name"))
    country = text(job.get("country_code"))
    country = "IN" if country and country.casefold() in {"india", "in"} else country
    apply_url = clean_url(job.get("final_url")) or clean_url(job.get("url"))
    work_arrangement = job.get("workplace_type")
    if not isinstance(work_arrangement, str) or work_arrangement not in {"remote", "hybrid", "on_site"}:
        work_arrangement = None
    source_id = job.get("id")
    company_size = number(company_object.get("employee_count"))
    if not isinstance(company_size, int):
        company_size = None
    canonical = json.dumps(
        [title.casefold(), (company or "").casefold(), apply_url or ""],
        ensure_ascii=False, separators=(",", ":"),
    )
    return {
        "source": "theirstack",
        "source_job_id": str(source_id) if isinstance(source_id, (str, int)) and not isinstance(source_id, bool) else None,
        "canonical_hash": hashlib.sha256(canonical.encode()).hexdigest(),
        "title": title, "company": company, "company_size": company_size,
        "location": text(job.get("location")), "country": country,
        "work_arrangement": work_arrangement,
        "employment_type": text(job.get("employment_status")),
        "posted_at": timestamp(job.get("date_posted")),
        "apply_url": apply_url, "description": text(job.get("description")),
        "skills": [], "salary_min": number(job.get("salary_min")),
        "salary_max": number(job.get("salary_max")), "salary_currency": text(job.get("salary_currency")),
        "raw_payload": job,
        "validation": {"passed": False, "reasons": ["connectivity_probe_only_not_validated"]},
    }


def request_for(key: str) -> Request:
    return Request(
        THEIRSTACK_ENDPOINT,
        data=json.dumps(THEIRSTACK_BODY).encode(), method="POST",
        headers={"Authorization": "Bearer " + key, "Content-Type": "application/json", "Accept": "application/json"},
    )


def redact(value: Any, secrets: list[str]) -> Any:
    """Sanitize allowlisted values if an upstream response echoes a key."""
    if isinstance(value, dict):
        return {key: redact(item, secrets) for key, item in value.items()}
    if isinstance(value, list):
        return [redact(item, secrets) for item in value]
    if isinstance(value, str):
        if any(secret and secret in value for secret in secrets):
            return "[REDACTED]"
        return " ".join(value.split())[:256].encode("utf-8", errors="replace").decode("utf-8")
    return value


def inspect_payload(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict) or not isinstance(payload.get("data"), list):
        return {"json_parsed": True, "data_is_job_array": False, "error": "unexpected_response_schema", "passed": False}
    jobs = payload["data"]
    objects = [job for job in jobs if isinstance(job, dict)]
    parsed = []
    parse_errors = 0
    for job in objects:
        try:
            parsed.append(normalize_probe(job))
        except ValueError:
            parse_errors += 1
    diagnostics: dict[str, Any] = {
        "json_parsed": True, "data_is_job_array": True,
        "jobs_returned": len(jobs), "jobs_normalized": len(parsed),
        "normalization_failures": parse_errors + len(jobs) - len(objects),
        "usable_apply_urls": sum(bool(job["apply_url"]) for job in parsed),
        "reliable_utc_timestamps": sum(bool(job["posted_at"]) for job in parsed),
        "passed": bool(jobs) and len(parsed) == len(jobs), "warnings": [],
    }
    if not jobs:
        diagnostics["warnings"].append("empty_data_schema_parseable_but_job_normalization_unproven")
    if diagnostics["usable_apply_urls"] < len(parsed):
        diagnostics["warnings"].append("some_jobs_lack_usable_apply_url")
    if diagnostics["reliable_utc_timestamps"] < len(parsed):
        diagnostics["warnings"].append("some_posting_dates_are_missing_date_only_naive_or_invalid")
    diagnostics["jobs"] = [{
        "id": job.get("id") if isinstance(job.get("id"), (str, int)) and not isinstance(job.get("id"), bool) else None,
        "job_title": text(job.get("job_title")), "company": text(job.get("company")),
        "country_code": text(job.get("country_code")), "date_posted": text(job.get("date_posted")),
        "seniority": text(job.get("seniority")), "final_url_exists": bool(text(job.get("final_url"))),
        "company_object_employee_count_exists": isinstance(job.get("company_object"), dict)
            and job["company_object"].get("employee_count") is not None,
    } for job in objects]
    metadata = payload.get("metadata")
    diagnostics["metadata_total_results"] = number(metadata.get("total_results")) if isinstance(metadata, dict) else None
    diagnostics["pagination"] = {
        "requested_page": THEIRSTACK_BODY["page"], "requested_limit": THEIRSTACK_BODY["limit"],
        "additional_pages_requested": 0, "include_total_results": False, "next_page_behavior_verified": False,
        "note": "Each successful additional request costs one credit. Next-page behavior not exercised.",
    }
    return diagnostics


def reject_non_json_constant(value: str) -> None:
    raise ValueError("non_json_numeric_constant")


def probe(key: str, opener: Any) -> dict[str, Any]:
    report: dict[str, Any] = {
        "endpoint": THEIRSTACK_ENDPOINT, "http_status": None,
        "requests_made": 1, "passed": False, "estimated_api_credits_used": 0,
    }
    try:
        with opener.open(request_for(key), timeout=45) as response:
            report["http_status"] = response.status
            report["rate_limit_headers"] = {
                name.lower(): value for name, value in response.headers.items() if name.lower() in RATE_HEADERS
            }
            if response.status != 200:
                report["error"] = "non_200_response"
                return report
            report["estimated_api_credits_used"] = 1
            body = response.read(MAX_RESPONSE_BYTES + 1)
            if len(body) > MAX_RESPONSE_BYTES:
                report["error"] = "response_exceeds_probe_size_limit"
                return report
            try:
                payload = json.loads(body, parse_constant=reject_non_json_constant)
            except (ValueError, UnicodeError, RecursionError):
                report["error"] = "response_is_not_valid_json"
                return report
            report.update(inspect_payload(payload))
    except HTTPError as error:
        report["http_status"] = error.code
        report["rate_limit_headers"] = {
            name.lower(): value for name, value in error.headers.items() if name.lower() in RATE_HEADERS
        } if error.headers else {}
        report["error"] = "http_error_no_response_body_logged"
        error.close()
    except (URLError, TimeoutError, OSError, HTTPException):
        report["error"] = "connection_error_no_exception_details_logged"
    return report


def run_gate(environment: dict[str, str], opener: Any = None) -> dict[str, Any]:
    # Only TheirStack is selected. JSearch credentials are neither read nor used.
    configured = {name: environment.get(name, "").strip() for name in SECRET_NAMES}
    key = next((configured[name] for name in SECRET_NAMES if configured[name]), "")
    if not key or any(not 33 <= ord(character) <= 126 for character in key):
        return {
            "passed": False, "requests_made": 0,
            "error": "Configure the TheirStack secret as a nonempty printable ASCII token before making a live request.",
            "missing_secrets" if not key else "invalid_secrets": [SECRET_NAMES[0]],
        }
    opener = opener if opener is not None else build_opener(NoRedirects())
    result = probe(key, opener)
    return redact({
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "passed": result["passed"], "sources": {"theirstack": result},
        "scope": "TheirStack connectivity only. JSearch deferred. No jobs saved, database access, or production eligibility validation.",
    }, sorted(set(configured.values()) - {""}, key=len, reverse=True))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", type=Path, help="Write only sanitized diagnostics as JSON")
    args = parser.parse_args()
    report = run_gate(dict(os.environ))
    safe_report = dict(report)
    safe_report.pop("missing_secrets", None)
    safe_report.pop("invalid_secrets", None)
    rendered = json.dumps(safe_report, indent=2, ensure_ascii=False, allow_nan=False)
    print(rendered)
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(rendered + "\n", encoding="utf-8")
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_path:
        with Path(summary_path).open("a", encoding="utf-8") as summary:
            summary.write("## TheirStack connectivity gate\n\n```json\n" + rendered.replace("`", "\\u0060") + "\n```\n")
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
