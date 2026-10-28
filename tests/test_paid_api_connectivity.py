"""Standalone stdlib tests: one scripted TheirStack request, no live network."""
from copy import deepcopy
from email.message import Message
from http.client import IncompleteRead
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import HTTPError, URLError

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts import test_paid_job_apis as api  # noqa: E402

ENV = {"THEIRSTACK_API_KEY": "offline-theirstack"}
JOB = {
    "id": 2, "job_title": "Python Developer", "company": "Example Ltd",
    "country_code": "IN", "date_posted": "2026-10-26",
    "seniority": "junior", "final_url": "https://example.invalid/careers/2",
    "company_object": {"employee_count": 100},
    "description": "PRIVATE_FULL_DESCRIPTION_SENTINEL", "workplace_type": "hybrid",
}


class Response:
    def __init__(self, payload=None, *, body=None, status=200, headers=None):
        self.status = status
        self.headers = Message()
        for key, value in (headers or {}).items():
            self.headers[key] = value
        self.body = body if body is not None else json.dumps(payload).encode()

    def read(self, size):
        return self.body[:size]

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class Opener:
    def __init__(self, *outcomes):
        self.outcomes = list(outcomes)
        self.requests = []

    def open(self, request, timeout):
        self.requests.append((request, timeout))
        if not self.outcomes:
            raise AssertionError("Unexpected additional request")
        outcome = self.outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


def successful_opener():
    return Opener(Response({"data": [deepcopy(JOB)], "metadata": {"total_results": 7}},
                           headers={"RateLimit-Limit": "10", "RateLimit-Remaining": "9", "RateLimit-Reset": "60"}))


class ConnectivityTests(unittest.TestCase):
    def setUp(self):
        # A forgotten fixture must fail rather than contacting a live provider.
        guard = patch.object(api, "build_opener", side_effect=AssertionError("Live network forbidden in offline tests"))
        guard.start()
        self.addCleanup(guard.stop)

    def test_only_theirstack_is_requested_without_any_jsearch_key(self):
        opener = successful_opener()
        report = api.run_gate(ENV, opener)
        self.assertTrue(report["passed"])
        self.assertEqual(set(report["sources"]), {"theirstack"})
        self.assertEqual(len(opener.requests), 1)
        self.assertEqual(report["sources"]["theirstack"]["requests_made"], 1)
        self.assertEqual(opener.requests[0][0].full_url, "https://api.theirstack.com/v1/jobs/search")

    def test_jsearch_configuration_does_not_add_requests_or_change_provider(self):
        opener = successful_opener()
        report = api.run_gate({**ENV, "JSEARCH_API_KEY": "unused", "X_API_KEY": "unused", "X_RAPIDAPI_KEY": "unused"}, opener)
        self.assertTrue(report["passed"])
        self.assertEqual(set(report["sources"]), {"theirstack"})
        self.assertEqual(len(opener.requests), 1)
        self.assertEqual(opener.requests[0][0].get_header("Authorization"), "Bearer " + ENV["THEIRSTACK_API_KEY"])
        self.assertIsNone(opener.requests[0][0].get_header("X-rapidapi-key"))
        self.assertIsNone(opener.requests[0][0].get_header("X-api-key"))

    def test_legacy_secret_alias_and_canonical_precedence(self):
        for environment in (
            {"THEIR_STACK_API_KEY": ENV["THEIRSTACK_API_KEY"]},
            {**ENV, "THEIR_STACK_API_KEY": "offline-unused"},
            {"THEIRSTACK_API_KEY": "   ", "THEIR_STACK_API_KEY": ENV["THEIRSTACK_API_KEY"]},
        ):
            with self.subTest(names=list(environment)):
                opener = successful_opener()
                self.assertTrue(api.run_gate(environment, opener)["passed"])
                self.assertEqual(opener.requests[0][0].get_header("Authorization"), "Bearer " + ENV["THEIRSTACK_API_KEY"])

    def test_missing_secret_makes_zero_requests(self):
        for environment in ({}, {"THEIRSTACK_API_KEY": " "}, {"X_RAPIDAPI_KEY": "unused"}):
            with self.subTest(names=list(environment)):
                opener = Opener()
                report = api.run_gate(environment, opener)
                self.assertFalse(report["passed"])
                self.assertEqual(report["missing_secrets"], ["THEIRSTACK_API_KEY"])
                self.assertEqual(report["requests_made"], 0)
                self.assertEqual(opener.requests, [])

    def test_invalid_header_credentials_fail_preflight_without_alias_fallback(self):
        for key in ("offline\ninjected", "offline\x00key", "offline key", "offline\N{SNOWMAN}"):
            with self.subTest(key_type=repr(key)):
                opener = Opener()
                report = api.run_gate({"THEIRSTACK_API_KEY": key, "THEIR_STACK_API_KEY": "valid-alias"}, opener)
                self.assertFalse(report["passed"])
                self.assertEqual(report["invalid_secrets"], ["THEIRSTACK_API_KEY"])
                self.assertEqual(report["requests_made"], 0)
                self.assertEqual(opener.requests, [])
                self.assertNotIn(key, json.dumps(report))

    def test_exact_request_has_one_page_and_no_total_count(self):
        opener = successful_opener()
        self.assertTrue(api.run_gate(ENV, opener)["passed"])
        request, timeout = opener.requests[0]
        self.assertEqual(request.get_method(), "POST")
        self.assertEqual(request.full_url, api.THEIRSTACK_ENDPOINT)
        self.assertEqual(json.loads(request.data), {
            "job_title_or": ["frontend developer", "python developer"],
            "job_country_code_or": ["IN"], "posted_at_max_age_days": 1,
            "job_seniority_or": ["junior"], "employment_statuses_or": ["full_time", "internship"],
            "workplace_types_or": ["remote", "hybrid", "on_site"], "limit": 10, "page": 0,
        })
        self.assertNotIn("include_total_results", json.loads(request.data))
        self.assertEqual(request.get_header("Authorization"), "Bearer " + ENV["THEIRSTACK_API_KEY"])
        self.assertEqual(request.get_header("Content-type"), "application/json")
        self.assertEqual(timeout, 45)
        self.assertEqual(len(opener.requests), 1)

    def test_normalized_shape_tracking_independent_hash_and_url_fallback(self):
        job = deepcopy(JOB)
        job["final_url"] = None
        job["url"] = "https://example.invalid/careers/2?utm_source=feed&id=2"
        normalized = api.normalize_probe(job)
        self.assertEqual(normalized["source"], "theirstack")
        self.assertEqual(normalized["source_job_id"], "2")
        self.assertEqual(normalized["apply_url"], "https://example.invalid/careers/2?id=2")
        self.assertEqual(len(normalized["canonical_hash"]), 64)
        self.assertFalse(normalized["validation"]["passed"])
        self.assertEqual(normalized["raw_payload"], job)
        job["url"] = "https://example.invalid/careers/2?id=2&FBCLID=tracking#ignored"
        self.assertEqual(api.normalize_probe(job)["canonical_hash"], normalized["canonical_hash"])
        job["job_title"] = "Different role"
        self.assertNotEqual(api.normalize_probe(job)["canonical_hash"], normalized["canonical_hash"])
        self.assertEqual(set(normalized), {
            "source", "source_job_id", "canonical_hash", "title", "company", "company_size",
            "location", "country", "work_arrangement", "employment_type", "posted_at",
            "apply_url", "description", "skills", "salary_min", "salary_max", "salary_currency",
            "raw_payload", "validation",
        })

    def test_unsafe_urls_rejected(self):
        for url in ("javascript:alert(1)", "https://user:password@host.invalid", "https://host.invalid:broken", "", None):
            self.assertIsNone(api.clean_url(url))

    def test_date_only_not_misrepresented_as_reliable_utc_timestamp(self):
        normalized = api.normalize_probe(deepcopy(JOB))
        self.assertIsNone(normalized["posted_at"])
        self.assertEqual(normalized["company_size"], 100)
        self.assertEqual(api.timestamp("2026-10-26T13:45:00+05:30"), "2026-10-26T08:15:00Z")
        self.assertIsNone(api.timestamp("2026-10-26T08:15:00"))
        for value in ("0001-01-01T00:00:00+14:00", "9999-12-31T23:59:59-14:00"):
            self.assertIsNone(api.timestamp(value))

    def test_company_size_unknown_and_malformed_optional_fields(self):
        job = deepcopy(JOB)
        job.update(company_object=None, workplace_type={}, salary_min="unknown", salary_max=float("inf"), id=True)
        normalized = api.normalize_probe(job)
        for field in ("company_size", "work_arrangement", "salary_min", "salary_max", "source_job_id"):
            self.assertIsNone(normalized[field])

    def test_safe_diagnostics_no_payload_descriptions_keys_or_partition_identity(self):
        report = api.run_gate(ENV, successful_opener())
        rendered = json.dumps(report)
        for forbidden in ("PRIVATE_FULL_DESCRIPTION_SENTINEL", *ENV.values(), '"raw_payload"'):
            self.assertNotIn(forbidden, rendered)
        source = report["sources"]["theirstack"]
        self.assertEqual(source["jobs_returned"], 1)
        self.assertTrue(source["jobs"][0]["final_url_exists"])
        self.assertTrue(source["jobs"][0]["company_object_employee_count_exists"])
        self.assertEqual(source["metadata_total_results"], 7)
        self.assertEqual(source["rate_limit_headers"]["ratelimit-remaining"], "9")
        self.assertEqual(source["estimated_api_credits_used"], 1)
        self.assertEqual(set(source["jobs"][0]), {
            "id", "job_title", "company", "country_code", "date_posted", "seniority",
            "final_url_exists", "company_object_employee_count_exists",
        })

    def test_rate_limit_partition_identity_and_unlisted_headers_are_not_logged(self):
        report = api.probe("offline", Opener(Response({"data": [JOB]}, headers={
            "RateLimit": '"per-second";r=3;t=1;pk=PRIVATE_PARTITION_IDENTITY',
            "RateLimit-Remaining": "3, 9, 49, 399", "Set-Cookie": "PRIVATE_COOKIE",
        })))
        self.assertEqual(report["rate_limit_headers"], {"ratelimit-remaining": "3, 9, 49, 399"})
        self.assertNotIn("PRIVATE_", json.dumps(report))

    def test_one_credit_per_successful_request_not_per_job(self):
        for count in (0, 1, 10):
            with self.subTest(count=count):
                report = api.probe("offline", Opener(Response({"data": [JOB] * count})))
                self.assertEqual(report["jobs_returned"], count)
                self.assertEqual(report["estimated_api_credits_used"], 1)
                self.assertEqual(report["requests_made"], 1)
                self.assertEqual(report["passed"], count > 0)

    def test_empty_malformed_and_partially_invalid_arrays_fail(self):
        for payload in ({"data": []}, {"data": [None]}, {"data": [{}]}, {"data": [JOB, {}]}, {"data": {}}, []):
            with self.subTest(payload=payload):
                self.assertFalse(api.inspect_payload(payload)["passed"])

    def test_missing_links_and_timestamps_are_warnings_not_fabricated(self):
        job = deepcopy(JOB)
        job["final_url"] = None
        report = api.inspect_payload({"data": [job]})
        self.assertTrue(report["passed"])
        self.assertEqual(report["usable_apply_urls"], 0)
        self.assertEqual(report["reliable_utc_timestamps"], 0)
        self.assertEqual(len(report["warnings"]), 2)

    def test_pagination_diagnostics_do_not_claim_unexercised_page_behavior(self):
        pagination = api.inspect_payload({"data": [JOB]})["pagination"]
        self.assertEqual(pagination["requested_page"], 0)
        self.assertEqual(pagination["requested_limit"], 10)
        self.assertEqual(pagination["additional_pages_requested"], 0)
        self.assertFalse(pagination["next_page_behavior_verified"])
        self.assertFalse(pagination["include_total_results"])

    def test_http_200_invalid_json_and_constants_fail_but_consume_credit(self):
        for body in (b"PRIVATE_NON_JSON", b"\xff", b'{"data": [], "n": NaN}', b'{"data": [], "n": Infinity}', b'{"data": [], "n": -Infinity}'):
            with self.subTest(body_type=body[:20]):
                report = api.probe("offline", Opener(Response(body=body)))
                self.assertFalse(report["passed"])
                self.assertEqual(report["http_status"], 200)
                self.assertEqual(report["estimated_api_credits_used"], 1)
                self.assertEqual(report["error"], "response_is_not_valid_json")
                self.assertNotIn("PRIVATE_", json.dumps(report))

    def test_deep_and_large_responses_fail_safely(self):
        for body, error in ((b"[" * 2000 + b"0" + b"]" * 2000, "response_is_not_valid_json"),
                            (b"x" * (api.MAX_RESPONSE_BYTES + 1), "response_exceeds_probe_size_limit")):
            with self.subTest(error=error):
                report = api.probe("offline", Opener(Response(body=body)))
                self.assertFalse(report["passed"])
                self.assertEqual(report["error"], error)
                self.assertEqual(report["estimated_api_credits_used"], 1)

    def test_invalid_unicode_job_fails_without_crashing_report(self):
        job = deepcopy(JOB)
        job["job_title"] = "bad\ud800title"
        report = api.run_gate(ENV, Opener(Response({"data": [job]})))
        self.assertFalse(report["passed"])
        self.assertEqual(report["sources"]["theirstack"]["normalization_failures"], 1)
        json.dumps(report, ensure_ascii=False).encode("utf-8")

    def test_http_error_is_one_request_no_retry_or_body_logging(self):
        headers = Message()
        headers["RateLimit-Remaining"] = "0"
        headers["RateLimit"] = "PRIVATE_IDENTITY"
        error = HTTPError(api.THEIRSTACK_ENDPOINT, 429, "PRIVATE_ERROR", headers, io.BytesIO(b"PRIVATE_BODY"))
        opener = Opener(error)
        report = api.run_gate(ENV, opener)
        self.assertFalse(report["passed"])
        self.assertEqual(report["sources"]["theirstack"]["http_status"], 429)
        self.assertEqual(report["sources"]["theirstack"]["estimated_api_credits_used"], 0)
        self.assertEqual(len(opener.requests), 1)
        self.assertNotIn("PRIVATE_", json.dumps(report))

    def test_non_200_response_cannot_pass(self):
        report = api.probe("offline", Opener(Response({"data": [JOB]}, status=201)))
        self.assertFalse(report["passed"])
        self.assertEqual(report["error"], "non_200_response")
        self.assertEqual(report["estimated_api_credits_used"], 0)

    def test_transport_errors_and_truncated_body_fail_without_details(self):
        for error in (URLError("PRIVATE_ERROR"), IncompleteRead(b"PRIVATE_PARTIAL_BODY", 10), TimeoutError("PRIVATE_TIMEOUT")):
            with self.subTest(error_type=type(error).__name__):
                opener = Opener(error)
                report = api.run_gate(ENV, opener)
                self.assertFalse(report["passed"])
                self.assertEqual(len(opener.requests), 1)
                self.assertNotIn("PRIVATE_", json.dumps(report))

    def test_all_configured_theirstack_keys_are_redacted_if_echoed(self):
        environment = {**ENV, "THEIR_STACK_API_KEY": "offline-unused-alias"}
        for key in environment.values():
            job = deepcopy(JOB)
            job["job_title"] = "prefix " + key + " suffix"
            report = api.run_gate(environment, Opener(Response({"data": [job]})))
            self.assertTrue(report["passed"])
            self.assertNotIn(key, json.dumps(report))
            self.assertEqual(report["sources"]["theirstack"]["jobs"][0]["job_title"], "[REDACTED]")

    def test_redaction_is_utf8_serializable_and_replaces_full_secret_string(self):
        self.assertEqual(api.redact("prefix offline-theirstack suffix", list(ENV.values())), "[REDACTED]")
        sanitized = api.redact({"job_title": "bad\ud800title"}, [])
        json.dumps(sanitized, ensure_ascii=False).encode("utf-8")

    def test_no_redirect_can_forward_credentials(self):
        self.assertIsNone(api.NoRedirects().redirect_request(None, None, 302, "", None, "https://evil.invalid"))

    def test_cli_legacy_alias_writes_sanitized_report_and_safe_summary(self):
        with tempfile.TemporaryDirectory() as directory:
            report_path = Path(directory) / "report.json"
            summary_path = Path(directory) / "summary.md"
            environment = {"THEIR_STACK_API_KEY": ENV["THEIRSTACK_API_KEY"], "GITHUB_STEP_SUMMARY": str(summary_path)}
            job = deepcopy(JOB)
            job["job_title"] = "Developer ```"
            opener = Opener(Response({"data": [job]}))
            with patch.dict("os.environ", environment, clear=True), \
                 patch.object(sys, "argv", ["probe", "--report", str(report_path)]), \
                 patch.object(api, "build_opener", return_value=opener), \
                 patch("sys.stdout", new_callable=io.StringIO) as stdout:
                self.assertEqual(api.main(), 0)
            self.assertTrue(json.loads(report_path.read_text())["passed"])
            self.assertEqual(len(opener.requests), 1)
            self.assertEqual(summary_path.read_text().count("```"), 2)
            for output in (stdout.getvalue(), report_path.read_text(), summary_path.read_text()):
                self.assertNotIn(ENV["THEIRSTACK_API_KEY"], output)
                self.assertNotIn("PRIVATE_FULL_DESCRIPTION_SENTINEL", output)

    def test_cli_missing_secret_is_failure_with_zero_requests(self):
        with tempfile.TemporaryDirectory() as directory:
            report_path = Path(directory) / "report.json"
            with patch.dict("os.environ", {}, clear=True), \
                 patch.object(sys, "argv", ["probe", "--report", str(report_path)]), \
                 patch("sys.stdout", new_callable=io.StringIO):
                self.assertEqual(api.main(), 1)
            report = json.loads(report_path.read_text())
            self.assertEqual(report["requests_made"], 0)
            self.assertIn("Configure the TheirStack secret", report["error"])

    def test_workflow_only_injects_theirstack_and_retains_failure_report(self):
        workflow = (Path(__file__).resolve().parents[1] / ".github/workflows/paid_api_connectivity.yml").read_text()
        self.assertIn("workflow_dispatch:", workflow)
        self.assertIn("contents: read", workflow)
        self.assertIn("secrets.THEIRSTACK_API_KEY || secrets.THEIR_STACK_API_KEY", workflow)
        self.assertIn("if: always()", workflow)
        for excluded in ("JSEARCH", "X_API_KEY", "RAPIDAPI", "SUPABASE", "schedule:", "continue-on-error:"):
            self.assertNotIn(excluded, workflow)
        self.assertLess(workflow.index("Offline probe regressions"), workflow.index("secrets.THEIRSTACK_API_KEY"))


if __name__ == "__main__":
    unittest.main()
