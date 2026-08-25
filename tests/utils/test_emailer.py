import pytest
from unittest.mock import patch, MagicMock, call

from utils.emailer import send_email


# ---------------------------------------------------------------------------
# Helper fixture to set SMTP environment variables
# ---------------------------------------------------------------------------
@pytest.fixture
def smtp_env(mock_env_vars):
    mock_env_vars.set(
        SMTP_HOST="smtp.example.com",
        SMTP_PORT="587",
        SMTP_USER="user@example.com",
        SMTP_PASS="secret",
    )
    return mock_env_vars


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------
def test_send_email_success(mock_smtp, smtp_env):
    """Happy path: SMTP_SSL is used, login and sendmail are called."""
    mock_ssl, mock_smtp = mock_smtp

    send_email("to@example.com", "Test Subject", "Test Body")

    # SMTP_SSL should be instantiated with host and port
    mock_ssl.assert_called_once_with("smtp.example.com", 587)
    instance = mock_ssl.return_value
    instance.login.assert_called_once_with("user@example.com", "secret")
    instance.sendmail.assert_called_once()

    # Verify the message contains the expected headers and body
    args, _ = instance.sendmail.call_args
    assert args[0] == "user@example.com"          # from address
    assert "to@example.com" in args[1]            # to address(es)
    assert "Test Subject" in args[2]
    assert "Test Body" in args[2]


def test_send_email_missing_host(mock_smtp, mock_env_vars):
    """Missing SMTP_HOST raises ValueError."""
    mock_env_vars.unset("SMTP_HOST")
    with pytest.raises(ValueError, match="SMTP_HOST"):
        send_email("to@example.com", "Subject", "Body")


def test_send_email_network_error(mock_smtp, smtp_env, caplog):
    """Connection error is logged and does not crash."""
    mock_ssl, mock_smtp = mock_smtp
    mock_ssl.side_effect = Exception("Connection refused")

    send_email("to@example.com", "Subject", "Body")

    assert "Connection refused" in caplog.text


def test_send_email_empty_body(mock_smtp, smtp_env):
    """Empty body is still sent."""
    mock_ssl, mock_smtp = mock_smtp

    send_email("to@example.com", "Subject", "")

    instance = mock_ssl.return_value
    instance.sendmail.assert_called_once()
    # The message should still contain the subject
    args, _ = instance.sendmail.call_args
    assert "Subject" in args[2]


def test_send_email_uses_correct_from_address(mock_smtp, smtp_env):
    """The from address is taken from SMTP_USER."""
    mock_ssl, mock_smtp = mock_smtp

    send_email("to@example.com", "Subject", "Body")

    instance = mock_ssl.return_value
    args, _ = instance.sendmail.call_args
    assert args[0] == "user@example.com"
