"""Standalone stdlib tests: scripted in-memory HTTP, no credentials/network."""
from copy import deepcopy
from email.message import Message
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import HTTPError, URLError
from http.client import IncompleteRead
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts import test_paid_job_apis as api  # noqa: E402

ENV = {"JSEARCH_API_KEY": "offline-jsearch", "THEIRSTACK_API_KEY": "offline-theirstack"}
JSEARCH_JOB = {
    "job_id": "j1", "job_title": " Frontend Developer ",
    "employer_name": " Example Ltd ", "job_country": "India",
    "job_city": "Bengaluru", "job_description": "PRIVATE_FULL_DESCRIPTION_SENTINEL",
    "job_posted_at_datetime_utc": "2026-10-26T08:15:00Z",
    "job_apply_is_direct": True,
    "job_apply_link": "https://example.invalid/careers/123?utm_source=feed&id=123",
    "apply_options": [], "job_is_remote": True,
}
THEIRSTACK_JOB = {
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
    return Opener(
        Response({"data": [deepcopy(JSEARCH_JOB)]}),
        Response({"data": [deepcopy(THEIRSTACK_JOB)], "metadata": {"total_results": 7}},
                 headers={"RateLimit-Limit": "10", "RateLimit-Remaining": "9", "RateLimit-Reset": "60"}),
    )


class ConnectivityTests(unittest.TestCase):
    def test_legacy_secret_aliases_and_canonical_precedence(self):
        environments = [
            {"X_API_KEY": ENV["JSEARCH_API_KEY"], "THEIR_STACK_API_KEY": ENV["THEIRSTACK_API_KEY"]},
            {**ENV, "X_API_KEY": "offline-unused-jsearch", "THEIR_STACK_API_KEY": "offline-unused-theirstack"},
            {**ENV, "JSEARCH_API_KEY": "   ", "X_API_KEY": ENV["JSEARCH_API_KEY"]},
        ]
        for environment in environments:
            with self.subTest(environment=list(environment)):
                opener = successful_opener()
                self.assertTrue(api.run_gate(environment, opener)["passed"])
                self.assertEqual(opener.requests[0][0].get_header("X-api-key"), ENV["JSEARCH_API_KEY"])
                self.assertEqual(opener.requests[1][0].get_header("Authorization"), "Bearer " + ENV["THEIRSTACK_API_KEY"])

    def test_invalid_header_credentials_fail_preflight_without_requests(self):
        for key in ("offline\ninjected", "offline\x00key", "offline key", "offline\N{SNOWMAN}"):
            with self.subTest(key_type=repr(key)):
                opener = Opener()
                report = api.run_gate({**ENV, "JSEARCH_API_KEY": key}, opener)
                self.assertFalse(report["passed"])
                self.assertEqual(report["invalid_secrets"], ["JSEARCH_API_KEY"])
                self.assertEqual(report["requests_made"], 0)
                self.assertEqual(opener.requests, [])
                self.assertNotIn(key, json.dumps(report))

    def test_unused_configured_secret_aliases_are_also_redacted(self):
        environment = {**ENV, "THEIR_STACK_API_KEY": "offline-unused-key"}
        job = deepcopy(THEIRSTACK_JOB)
        job["job_title"] = environment["THEIR_STACK_API_KEY"]
        report = api.run_gate(environment, Opener(Response({"data": [JSEARCH_JOB]}), Response({"data": [job]})))
        self.assertTrue(report["passed"])
        self.assertNotIn(environment["THEIR_STACK_API_KEY"], json.dumps(report))

    def test_pagination_reports_observation_not_unexercised_page_behavior(self):
        report = api.inspect_payload("jsearch", {"data": [JSEARCH_JOB], "next_cursor": "PRIVATE_CURSOR_SENTINEL"})
        pagination = report["pagination"]
        self.assertEqual(pagination["requested_num_pages"], 1)
        self.assertEqual(pagination["additional_pages_requested"], 0)
        self.assertTrue(pagination["cursor_field_present"])
        self.assertFalse(pagination["next_page_behavior_verified"])
        self.assertNotIn("default_page", pagination)
        self.assertNotIn("Page-based", pagination["note"])
        self.assertNotIn("PRIVATE_CURSOR_SENTINEL", json.dumps(report))

    def test_utc_conversion_overflow_is_unreliable_not_a_crash(self):
        for value in ("0001-01-01T00:00:00+14:00", "9999-12-31T23:59:59-14:00"):
            with self.subTest(value=value):
                self.assertIsNone(api.timestamp(value))

    def test_invalid_unicode_job_fails_safely_and_second_provider_still_runs(self):
        job = deepcopy(JSEARCH_JOB)
        job["job_title"] = "bad\ud800title"
        opener = Opener(Response({"data": [job]}), Response({"data": [THEIRSTACK_JOB]}))
        report = api.run_gate(ENV, opener)
        self.assertFalse(report["passed"])
        self.assertEqual(report["sources"]["jsearch"]["normalization_failures"], 1)
        self.assertTrue(report["sources"]["theirstack"]["passed"])
        self.assertEqual(len(opener.requests), 2)

    def test_deep_json_fails_safely_and_second_provider_still_runs(self):
        body = b"[" * 2000 + b"0" + b"]" * 2000
        opener = Opener(Response(body=body), Response({"data": [THEIRSTACK_JOB]}))
        report = api.run_gate(ENV, opener)
        self.assertFalse(report["passed"])
        self.assertEqual(report["sources"]["jsearch"]["error"], "response_is_not_valid_json")
        self.assertTrue(report["sources"]["theirstack"]["passed"])

    def test_truncated_http_body_is_safe_and_does_not_skip_second_provider(self):
        opener = Opener(IncompleteRead(b"PRIVATE_PARTIAL_BODY", 10), Response({"data": [THEIRSTACK_JOB]}))
        report = api.run_gate(ENV, opener)
        self.assertFalse(report["passed"])
        self.assertTrue(report["sources"]["theirstack"]["passed"])
        self.assertEqual(len(opener.requests), 2)
        self.assertNotIn("PRIVATE_PARTIAL_BODY", json.dumps(report))

    def test_secret_bearing_diagnostic_is_replaced_in_full(self):
        self.assertEqual(
            api.redact("prefix offline-jsearch suffix", list(ENV.values())),
            "[REDACTED]",
        )

    def test_redaction_output_is_utf8_serializable(self):
        value = {"job_title": "bad\ud800title"}
        sanitized = api.redact(value, [])
        json.dumps(sanitized, ensure_ascii=False).encode("utf-8")

    def test_workflow_keeps_probe_failure_and_always_retains_safe_report(self):
        workflow = (Path(__file__).resolve().parents[1] / ".github/workflows/paid_api_connectivity.yml").read_text()
        self.assertNotIn("continue-on-error:", workflow)
        self.assertIn("if: always()", workflow)
        self.assertIn("secrets.JSEARCH_API_KEY || secrets.X_API_KEY", workflow)
        self.assertIn("secrets.THEIRSTACK_API_KEY || secrets.THEIR_STACK_API_KEY", workflow)
        self.assertNotIn("SUPABASE", workflow)
        self.assertNotIn("schedule:", workflow)
        self.assertLess(workflow.index("Offline probe regressions"), workflow.index("secrets.JSEARCH_API_KEY"))

    def test_exact_requests_and_no_pagination_or_total_count(self):
        opener = successful_opener()
        report = api.run_gate(ENV, opener)
        self.assertTrue(report["passed"])
        self.assertEqual(len(opener.requests), 2)
        jsearch, theirstack = [request for request, _ in opener.requests]
        self.assertEqual(jsearch.get_method(), "POST")
        self.assertEqual(jsearch.full_url, api.JSEARCH_ENDPOINT)
        self.assertEqual(urlsplit(jsearch.full_url).query, "")
        self.assertEqual(json.loads(jsearch.data), api.JSEARCH_PARAMS)
        self.assertEqual(jsearch.get_header("X-api-key"), ENV["JSEARCH_API_KEY"])
        self.assertEqual(jsearch.get_header("Content-type"), "application/json")
        self.assertEqual(theirstack.get_method(), "POST")
        self.assertEqual(theirstack.full_url, api.THEIRSTACK_ENDPOINT)
        self.assertEqual(json.loads(theirstack.data), api.THEIRSTACK_BODY)
        self.assertNotIn("include_total_results", json.loads(theirstack.data))
        self.assertEqual(theirstack.get_header("Authorization"), "Bearer " + ENV["THEIRSTACK_API_KEY"])
        self.assertEqual([timeout for _, timeout in opener.requests], [45, 45])

    def test_missing_either_secret_makes_zero_requests(self):
        for missing in ENV:
            with self.subTest(missing=missing):
                opener = Opener()
                report = api.run_gate({key: val for key, val in ENV.items() if key != missing}, opener)
                self.assertFalse(report["passed"])
                self.assertEqual(report["missing_secrets"], [missing])
                self.assertEqual(report["requests_made"], 0)
                self.assertEqual(opener.requests, [])

    def test_normalized_complete_shape_and_tracking_independent_hash(self):
        normalized = api.normalize_probe("jsearch", deepcopy(JSEARCH_JOB))
        self.assertEqual(normalized["source_job_id"], "j1")
        self.assertEqual(normalized["country"], "IN")
        self.assertEqual(normalized["location"], "Bengaluru, India")
        self.assertEqual(normalized["apply_url"], "https://example.invalid/careers/123?id=123")
        self.assertEqual(len(normalized["canonical_hash"]), 64)
        self.assertFalse(normalized["validation"]["passed"])
        self.assertEqual(normalized["raw_payload"], JSEARCH_JOB)
        changed = deepcopy(JSEARCH_JOB)
        changed["job_apply_link"] = "https://example.invalid/careers/123?id=123&FBCLID=tracking#ignored"
        self.assertEqual(api.normalize_probe("jsearch", changed)["canonical_hash"], normalized["canonical_hash"])
        changed["job_title"] = "Different role"
        self.assertNotEqual(api.normalize_probe("jsearch", changed)["canonical_hash"], normalized["canonical_hash"])
        self.assertEqual(set(normalized), {
            "source", "source_job_id", "canonical_hash", "title", "company", "company_size",
            "location", "country", "work_arrangement", "employment_type", "posted_at",
            "apply_url", "description", "skills", "salary_min", "salary_max", "salary_currency",
            "raw_payload", "validation",
        })

    def test_direct_option_url_preferred_and_unsafe_urls_rejected(self):
        job = deepcopy(JSEARCH_JOB)
        job["apply_options"] = [{"is_direct": True, "apply_link": "https://employer.invalid/apply?gclid=abc"}]
        self.assertEqual(api.normalize_probe("jsearch", job)["apply_url"], "https://employer.invalid/apply")
        for url in ("javascript:alert(1)", "https://user:password@host.invalid", "https://host.invalid:broken", "", None):
            self.assertIsNone(api.clean_url(url))

    def test_date_only_not_misrepresented_as_reliable_utc_timestamp(self):
        normalized = api.normalize_probe("theirstack", deepcopy(THEIRSTACK_JOB))
        self.assertIsNone(normalized["posted_at"])
        self.assertEqual(normalized["company_size"], 100)
        self.assertEqual(normalized["source_job_id"], "2")
        self.assertEqual(api.timestamp("2026-10-26T13:45:00+05:30"), "2026-10-26T08:15:00Z")
        self.assertIsNone(api.timestamp("2026-10-26T08:15:00"))

    def test_company_size_unknown_and_malformed_optional_fields(self):
        job = deepcopy(THEIRSTACK_JOB)
        job.update(company_object=None, workplace_type={}, salary_min="unknown")
        normalized = api.normalize_probe("theirstack", job)
        self.assertIsNone(normalized["company_size"])
        self.assertIsNone(normalized["work_arrangement"])
        self.assertIsNone(normalized["salary_min"])

    def test_safe_diagnostics_include_required_fields_but_no_raw_descriptions_or_keys(self):
        report = api.run_gate(ENV, successful_opener())
        rendered = json.dumps(report)
        for forbidden in ("PRIVATE_FULL_DESCRIPTION_SENTINEL", *ENV.values(), '"raw_payload"'):
            self.assertNotIn(forbidden, rendered)
        jsearch = report["sources"]["jsearch"]
        self.assertEqual(jsearch["fields"]["job_id"], {"present": 1, "populated": 1})
        self.assertEqual(jsearch["fields"]["job_location"], {"present": 0, "populated": 0})
        ts = report["sources"]["theirstack"]
        self.assertEqual(ts["jobs_returned"], 1)
        self.assertTrue(ts["jobs"][0]["final_url_exists"])
        self.assertTrue(ts["jobs"][0]["company_object_employee_count_exists"])
        self.assertEqual(ts["metadata_total_results"], 7)
        self.assertEqual(ts["rate_limit_headers"]["ratelimit-remaining"], "9")
        self.assertEqual(ts["estimated_api_credits_used"], 1)

    def test_one_credit_per_successful_request_not_per_job(self):
        for count in (0, 1, 10):
            with self.subTest(count=count):
                report = api.probe("theirstack", "offline", Opener(Response({"data": [THEIRSTACK_JOB] * count})))
                self.assertEqual(report["jobs_returned"], count)
                self.assertEqual(report["estimated_api_credits_used"], 1)
                self.assertEqual(report["requests_made"], 1)

    def test_empty_and_malformed_arrays_do_not_prove_normalization(self):
        for payload in ({"data": []}, {"data": [None]}, {"data": [{}]}, {"data": {}}, []):
            with self.subTest(payload=payload):
                report = api.inspect_payload("theirstack", payload)
                self.assertFalse(report["passed"])

    def test_http_200_with_invalid_json_fails_but_consumes_credit(self):
        report = api.probe("theirstack", "offline", Opener(Response(body=b"PRIVATE_NON_JSON_SENTINEL")))
        self.assertFalse(report["passed"])
        self.assertEqual(report["http_status"], 200)
        self.assertEqual(report["estimated_api_credits_used"], 1)
        self.assertNotIn("PRIVATE_NON_JSON_SENTINEL", json.dumps(report))

    def test_http_error_one_provider_still_calls_other(self):
        headers = Message()
        headers["RateLimit-Remaining"] = "0"
        error = HTTPError(api.THEIRSTACK_ENDPOINT, 429, "PRIVATE_ERROR_SENTINEL", headers, io.BytesIO(b"PRIVATE_BODY_SENTINEL"))
        opener = Opener(Response({"data": [JSEARCH_JOB]}), error)
        report = api.run_gate(ENV, opener)
        self.assertFalse(report["passed"])
        self.assertTrue(report["sources"]["jsearch"]["passed"])
        self.assertEqual(report["sources"]["theirstack"]["http_status"], 429)
        self.assertEqual(report["sources"]["theirstack"]["estimated_api_credits_used"], 0)
        self.assertEqual(len(opener.requests), 2)  # No automatic probe retries.
        self.assertNotIn("PRIVATE_", json.dumps(report))

    def test_transport_failure_does_not_skip_second_provider_or_log_error(self):
        opener = Opener(URLError("PRIVATE_SECRET_SENTINEL"), Response({"data": [THEIRSTACK_JOB]}))
        report = api.run_gate(ENV, opener)
        self.assertFalse(report["passed"])
        self.assertTrue(report["sources"]["theirstack"]["passed"])
        self.assertEqual(len(opener.requests), 2)
        self.assertNotIn("PRIVATE_SECRET_SENTINEL", json.dumps(report))

    def test_redacts_keys_even_if_upstream_echoes_them(self):
        job = deepcopy(THEIRSTACK_JOB)
        job["job_title"] = ENV["THEIRSTACK_API_KEY"] + "\n" + ENV["JSEARCH_API_KEY"]
        report = api.run_gate(ENV, Opener(Response({"data": [JSEARCH_JOB]}), Response({"data": [job]})))
        for secret in ENV.values():
            self.assertNotIn(secret, json.dumps(report))
        self.assertIn("[REDACTED]", json.dumps(report))

    def test_large_response_rejected_without_logging(self):
        response = Response(body=b"x" * (api.MAX_RESPONSE_BYTES + 1))
        report = api.probe("theirstack", "offline", Opener(response))
        self.assertEqual(report["error"], "response_exceeds_probe_size_limit")
        self.assertEqual(report["estimated_api_credits_used"], 1)

    def test_no_redirect_can_forward_credentials(self):
        self.assertIsNone(api.NoRedirects().redirect_request(None, None, 302, "", None, "https://evil.invalid"))

    def test_non_json_numeric_constants_fail_safely_but_record_http_200_credit(self):
        for constant in ("NaN", "Infinity", "-Infinity"):
            with self.subTest(constant=constant):
                body = ('{"data": [], "metadata": {"total_results": ' + constant + '}}').encode()
                report = api.probe("theirstack", "offline", Opener(Response(body=body)))
                self.assertFalse(report["passed"])
                self.assertEqual(report["error"], "response_is_not_valid_json")
                self.assertEqual(report["estimated_api_credits_used"], 1)

    def test_cli_legacy_secrets_success_and_summary_cannot_escape_json_fence(self):
        with tempfile.TemporaryDirectory() as directory:
            report_path = Path(directory) / "report.json"
            summary_path = Path(directory) / "summary.md"
            environment = {
                "X_API_KEY": ENV["JSEARCH_API_KEY"],
                "THEIR_STACK_API_KEY": ENV["THEIRSTACK_API_KEY"],
                "GITHUB_STEP_SUMMARY": str(summary_path),
            }
            job = deepcopy(THEIRSTACK_JOB)
            job["job_title"] = "Developer ``` " + ENV["THEIRSTACK_API_KEY"]
            opener = Opener(Response({"data": [JSEARCH_JOB]}), Response({"data": [job]}))
            with patch.dict("os.environ", environment, clear=True), \
                 patch.object(sys, "argv", ["probe", "--report", str(report_path)]), \
                 patch.object(api, "build_opener", return_value=opener), \
                 patch("sys.stdout", new_callable=io.StringIO) as stdout:
                self.assertEqual(api.main(), 0)
            self.assertTrue(json.loads(report_path.read_text())["passed"])
            self.assertEqual(len(opener.requests), 2)
            self.assertEqual(summary_path.read_text().count("```"), 2)
            for output in (stdout.getvalue(), report_path.read_text(), summary_path.read_text()):
                for secret in ENV.values():
                    self.assertNotIn(secret, output)
                self.assertNotIn("PRIVATE_FULL_DESCRIPTION_SENTINEL", output)

    def test_one_request_per_provider_with_both_keys(self):
        from copy import deepcopy
        from tests.test_paid_api_connectivity import JSEARCH_JOB, THEIRSTACK_JOB
        opener = Opener(Response({"data": [deepcopy(JSEARCH_JOB)]}),
                          Response({"data": [deepcopy(THEIRSTACK_JOB)]}))
        report = api.run_gate(dict(ENV), opener)
        self.assertTrue(report["passed"])
        self.assertEqual(len(opener.requests), 2)
        self.assertEqual(report["sources"]["jsearch"]["requests_made"], 1)
        self.assertEqual(report["sources"]["theirstack"]["requests_made"], 1)
        self.assertEqual(report["sources"]["theirstack"]["estimated_api_credits_used"], 1)

    def test_workflow_dispatch_and_read_only_secrets(self):
        workflow = (Path(__file__).resolve().parents[1] / ".github/workflows/paid_api_connectivity.yml").read_text()
        self.assertIn("workflow_dispatch:", workflow)
        self.assertIn("permissions:", workflow)
        self.assertIn("contents: read", workflow)
        self.assertIn("secrets.JSEARCH_API_KEY || secrets.X_API_KEY", workflow)
        self.assertIn("secrets.THEIRSTACK_API_KEY || secrets.THEIR_STACK_API_KEY", workflow)
        self.assertNotIn("SUPABASE", workflow)

    def test_cli_writes_safe_report_and_summary_and_failure_exit(self):
        with tempfile.TemporaryDirectory() as directory:
            report_path = Path(directory) / "report.json"
            summary_path = Path(directory) / "summary.md"
            with patch.dict("os.environ", {"GITHUB_STEP_SUMMARY": str(summary_path)}, clear=True), \
                 patch.object(sys, "argv", ["probe", "--report", str(report_path)]), \
                 patch("sys.stdout", new_callable=io.StringIO):
                self.assertEqual(api.main(), 1)
            self.assertEqual(json.loads(report_path.read_text())["requests_made"], 0)
            self.assertIn("missing_secrets", summary_path.read_text())


if __name__ == "__main__":
    unittest.main()
