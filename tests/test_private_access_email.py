import smtplib
import ssl
from email import policy
from email.parser import Parser

import pytest

from workers import worker_access_request as worker


REQUEST_ID = "30000000-0000-0000-0000-000000000001"
CLAIM = {
    "status": "claimed",
    "request_id": REQUEST_ID,
    "user_id": "10000000-0000-0000-0000-000000000001",
    "email": "candidate@example.test",
    "name": "Test Candidate",
    "message": "Frontend roles, please.\nThank you.",
}


@pytest.mark.parametrize("port", [465, 587])
def test_claimed_request_sends_to_owner_with_verified_reply_to(port, monkeypatch, smtp_effects):
    calls = []

    def rpc(name, body):
        calls.append((name, body))
        if name == "claim_private_job_access_notification":
            assert smtp_effects.messages == []
            return dict(CLAIM)
        assert name == "set_private_job_access_notification"
        assert body == {"p_request_id": REQUEST_ID, "p_status": "sent"}
        assert len(smtp_effects.messages) == 1
        return True

    monkeypatch.setenv("SMTP_PORT", str(port))
    monkeypatch.setattr(worker, "database_rpc", rpc)
    assert worker.deliver_access_request(REQUEST_ID)
    assert len(calls) == 2
    sender, recipient, raw = smtp_effects.messages[0]
    assert sender == "sender@example.invalid"
    assert recipient == "recblackoff@gmail.com"
    mail = Parser(policy=policy.default).parsestr(raw)
    assert mail["To"] == "recblackoff@gmail.com"
    assert mail["Reply-To"] == "candidate@example.test"
    assert mail["Subject"] == "PJobB access request"
    assert CLAIM["message"] in mail.get_content()
    assert CLAIM["user_id"] in mail.get_content()
    options = smtp_effects.connections[0]
    assert options["timeout"] == 20
    context = options["context"] if port == 465 else smtp_effects.tls_context
    assert isinstance(context, ssl.SSLContext)
    assert context.check_hostname and context.verify_mode == ssl.CERT_REQUIRED


def test_a_workflow_rerun_never_resends_an_already_claimed_notification(monkeypatch, smtp_effects):
    claimed = False

    def rpc(name, body):
        nonlocal claimed
        if name == "claim_private_job_access_notification":
            if claimed:
                return {"status": "skipped"}
            claimed = True
            return dict(CLAIM)
        return True

    monkeypatch.setattr(worker, "database_rpc", rpc)
    assert worker.deliver_access_request(REQUEST_ID)
    assert worker.deliver_access_request(REQUEST_ID) is False
    assert len(smtp_effects.messages) == 1


def test_smtp_failure_records_failure_without_retrying(monkeypatch, smtp_effects):
    calls = []

    def rpc(name, body):
        calls.append((name, body))
        return dict(CLAIM) if name == "claim_private_job_access_notification" else True

    monkeypatch.setattr(worker, "database_rpc", rpc)
    smtp_effects.failures.append(smtplib.SMTPServerDisconnected("offline failure"))
    with pytest.raises(smtplib.SMTPServerDisconnected):
        worker.deliver_access_request(REQUEST_ID)
    assert smtp_effects.messages == []
    assert len(smtp_effects.connections) == 1
    assert calls[-1] == ("set_private_job_access_notification", {"p_request_id": REQUEST_ID, "p_status": "failed"})


def test_missing_smtp_credentials_fail_instead_of_reporting_sent(monkeypatch, smtp_effects):
    calls = []

    def rpc(name, body):
        calls.append((name, body))
        return dict(CLAIM) if name == "claim_private_job_access_notification" else True

    monkeypatch.setattr(worker, "database_rpc", rpc)
    monkeypatch.setenv("SMTP_PASSWORD", "")
    with pytest.raises(RuntimeError, match="SMTP is not configured"):
        worker.deliver_access_request(REQUEST_ID)
    assert smtp_effects.messages == []
    assert calls[-1][1]["p_status"] == "failed"


def test_ambiguous_database_ack_after_smtp_does_not_resend(monkeypatch, smtp_effects):
    claimed = False

    def rpc(name, body):
        nonlocal claimed
        if name == "claim_private_job_access_notification":
            if claimed:
                return {"status": "skipped"}
            claimed = True
            return dict(CLAIM)
        raise RuntimeError("Offline database acknowledgement lost")

    monkeypatch.setattr(worker, "database_rpc", rpc)
    with pytest.raises(RuntimeError):
        worker.deliver_access_request(REQUEST_ID)
    assert worker.deliver_access_request(REQUEST_ID) is False
    assert len(smtp_effects.messages) == 1


@pytest.mark.parametrize("field,value", [
    ("email", "victim@example.test\nBcc: other@example.test"),
    ("name", "Candidate\nInjected header"),
    ("message", "a" * 1001),
    ("user_id", "not-a-uuid"),
])
def test_bad_saved_fields_cannot_become_mail_headers(field, value):
    with pytest.raises((ValueError, TypeError)):
        worker.build_access_request_email({**CLAIM, field: value}, "sender@example.invalid")


def test_mail_body_text_cannot_inject_headers():
    mail = worker.build_access_request_email({**CLAIM, "message": "Bcc: victim@example.test\n<script>example</script>"},
                                            "sender@example.invalid")
    assert mail["Bcc"] is None
    assert mail.get_content_type() == "text/plain"
    assert "<script>example</script>" in mail.get_content()


def test_invalid_workflow_id_stops_before_database_or_smtp(monkeypatch, smtp_effects):
    monkeypatch.setattr(worker, "database_rpc", lambda *args: pytest.fail("Invalid ID reached database"))
    with pytest.raises(ValueError):
        worker.deliver_access_request("not-a-uuid")
    assert smtp_effects.messages == []


def test_notification_failures_do_not_log_keys_or_applicant_data(monkeypatch, capsys):
    def fail(_request_id):
        raise RuntimeError("secret-key candidate@example.test SMTP-password")

    monkeypatch.setattr(worker, "deliver_access_request", fail)
    assert worker.main() == 1
    output = capsys.readouterr().out
    assert "Notification failed" in output
    assert "secret-key" not in output and "candidate@example.test" not in output and "SMTP-password" not in output
