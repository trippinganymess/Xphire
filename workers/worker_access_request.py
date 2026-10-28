"""Deliver only PJobB access-request notifications; no scraper or paid API calls."""

import json
import os
import re
import smtplib
import ssl
import urllib.error
import urllib.parse
import urllib.request
import uuid
from email.message import EmailMessage


ACCESS_REQUEST_RECIPIENT = "recblackoff@gmail.com"
EMAIL_PATTERN = re.compile(r"^[^\s@<>\x00-\x1f\x7f]+@[^\s@<>\x00-\x1f\x7f]+\.[^\s@<>\x00-\x1f\x7f]+$")


class NoRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise urllib.error.HTTPError(req.full_url, code, "Redirects are disabled", headers, fp)


def database_rpc(name: str, body: dict) -> object:
    base = os.environ.get("SUPABASE_URL", "").strip().rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_KEY", "").strip()
    parsed = urllib.parse.urlsplit(base)
    if (parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password
            or parsed.query or parsed.fragment or not key or not key.isascii()
            or any(ord(char) < 33 or ord(char) > 126 for char in key)):
        raise RuntimeError("Notification database is not configured")
    request = urllib.request.Request(
        base + "/rest/v1/rpc/" + name,
        data=json.dumps(body).encode("utf-8"),
        headers={"apikey": key, "Authorization": "Bearer " + key, "Content-Type": "application/json"},
        method="POST",
    )
    opener = urllib.request.build_opener(NoRedirects())
    with opener.open(request, timeout=20) as response:
        raw = response.read(16_385)
    if len(raw) > 16_384:
        raise RuntimeError("Invalid notification response")
    return json.loads(raw)


def build_access_request_email(request: dict, sender: str) -> EmailMessage:
    email = request.get("email")
    name = request.get("name")
    message = request.get("message")
    user_id = request.get("user_id")
    request_id = request.get("request_id")
    if (not isinstance(email, str) or len(email) > 254 or not EMAIL_PATTERN.fullmatch(email)
            or not isinstance(name, str) or not 1 <= len(name) <= 80
            or any(ord(char) < 32 or ord(char) == 127 for char in name)
            or not isinstance(message, str) or len(message) > 1000):
        raise ValueError("Invalid access request")
    uuid.UUID(user_id)
    uuid.UUID(request_id)
    if not EMAIL_PATTERN.fullmatch(sender):
        raise ValueError("Invalid SMTP sender")
    mail = EmailMessage()
    mail["Subject"] = "PJobB access request"
    mail["From"] = "Xphire <" + sender + ">"
    mail["To"] = ACCESS_REQUEST_RECIPIENT
    mail["Reply-To"] = email
    mail["Message-ID"] = "<pjobb-access-" + request_id + "@xphire>"
    mail.set_content(
        "A signed-in Xphire user requested PJobB access.\n\n"
        + "Name: " + name + "\n"
        + "Account email: " + email + "\n"
        + "Auth user ID: " + user_id + "\n"
        + "Request ID: " + request_id + "\n\n"
        + "Message:\n" + (message or "(No message provided)") + "\n\n"
        + "Reply to this email to contact the requester. Grant or renew access "
        + "using the existing administrator-managed PJobB entitlement process.\n"
    )
    return mail


def send_access_request_email(request: dict) -> None:
    host = os.environ.get("SMTP_HOST", "").strip() or "smtp.gmail.com"
    port = int(os.environ.get("SMTP_PORT", "").strip() or "465")
    sender = os.environ.get("SMTP_USER", "").strip()
    password = os.environ.get("SMTP_PASSWORD", "")
    if not sender or not password or port not in (465, 587):
        raise RuntimeError("SMTP is not configured")
    mail = build_access_request_email(request, sender)
    context = ssl.create_default_context()
    # No SMTP retries: an ambiguous acknowledgement must not cause duplicate mail.
    smtp = smtplib.SMTP_SSL if port == 465 else smtplib.SMTP
    options = {"timeout": 20}
    if port == 465:
        options["context"] = context
    with smtp(host, port, **options) as server:
        if port == 587:
            server.ehlo()
            server.starttls(context=context)
            server.ehlo()
        server.login(sender, password)
        refused = server.sendmail(sender, ACCESS_REQUEST_RECIPIENT, mail.as_string())
        if refused:
            raise smtplib.SMTPRecipientsRefused(refused)


def deliver_access_request(request_id: str) -> bool:
    request_id = str(uuid.UUID(request_id))
    request = database_rpc("claim_private_job_access_notification", {"p_request_id": request_id})
    if isinstance(request, dict) and request.get("status") == "skipped":
        return False
    if (not isinstance(request, dict) or request.get("status") != "claimed"
            or request.get("request_id") != request_id):
        raise RuntimeError("Invalid notification claim")
    try:
        send_access_request_email(request)
    except Exception:
        try:
            database_rpc("set_private_job_access_notification", {"p_request_id": request_id, "p_status": "failed"})
        except Exception:
            pass  # Keep the durable sending state; do not retry uncertain mail.
        raise
    if database_rpc("set_private_job_access_notification", {"p_request_id": request_id, "p_status": "sent"}) is not True:
        raise RuntimeError("Unable to confirm notification status")
    return True


def main() -> int:
    try:
        sent = deliver_access_request(os.environ.get("ACCESS_REQUEST_ID", ""))
        print("[PJobB] Access notification sent." if sent else "[PJobB] Notification already claimed or completed.")
        return 0
    except Exception:
        # Never write applicant data, database bodies, SMTP errors or keys to logs.
        print("[PJobB] Notification failed. Check delivery configuration and the saved request status.")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
