"""Offline effect boundaries, installed before test modules are collected.

No sys.modules replacements: the installed HTTPX, Gemini, pandas and JobSpy
packages are imported normally. Unexpected effects fail even inside production
code's broad ``except Exception`` fallbacks (pytest.fail raises BaseException).
Only the opt-in fixtures below permit explicitly scripted, in-process effects.
"""

import asyncio
import os
import smtplib
import socket
import time
import urllib.request
from collections import deque
from types import SimpleNamespace

import httpx
import jobspy
import pandas as pd
import pytest
import requests
import time_machine
from google import genai


_SESSION_PATCH = pytest.MonkeyPatch()
_SECRET_PREFIXES = (
    "SUPABASE_", "GEMINI_", "GOOGLE_", "SMTP_", "GITHUB_", "GH_", "AWS_",
    "AZURE_", "OPENAI_", "ANTHROPIC_", "CLOUDSDK_", "VERTEX_",
)
_INPUT_KEYS = {
    "JOB_TITLE", "RECIPIENT_EMAIL", "FRESHERS_ONLY", "MIN_STARS", "PROXY_URL",
    "SCRAPE_KEYWORDS", "AI_CALL_TIMEOUT_SECONDS", "AI_IDLE_TIMEOUT_SECONDS",
    "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NETRC",
}


def deny_effect(*args, **kwargs):
    pytest.fail("Unscripted network/model/SMTP/JobSpy effect blocked by offline tests")


async def deny_async_effect(*args, **kwargs):
    deny_effect()


def install_safety(patch):
    for key in tuple(os.environ):
        if (
            key.startswith(_SECRET_PREFIXES)
            or key in _INPUT_KEYS
            or key.endswith(("_API_KEY", "_TOKEN", "_PASSWORD", "_SECRET"))
        ):
            patch.delenv(key, raising=False)
    patch.setenv("NO_PROXY", "*")
    for method in ("connect", "connect_ex", "sendto"):
        patch.setattr(socket.socket, method, deny_effect)
    # Keep asyncio's local wakeup socketpair usable, but forbid raw TCP writes.
    for method in ("send", "sendall"):
        original = getattr(socket.socket, method)

        def guarded_send(sock, *args, _original=original, **kwargs):
            if sock.family in (socket.AF_INET, socket.AF_INET6):
                deny_effect()
            return _original(sock, *args, **kwargs)

        patch.setattr(socket.socket, method, guarded_send)
    patch.setattr(socket, "getaddrinfo", deny_effect)
    patch.setattr(socket, "create_connection", deny_effect)
    patch.setattr(httpx.HTTPTransport, "handle_request", deny_effect)
    patch.setattr(httpx.AsyncHTTPTransport, "handle_async_request", deny_async_effect)
    patch.setattr(requests.sessions.Session, "request", deny_effect)
    patch.setattr(urllib.request, "urlopen", deny_effect)
    patch.setattr(smtplib, "SMTP", deny_effect)
    patch.setattr(smtplib, "SMTP_SSL", deny_effect)
    patch.setattr(genai, "Client", deny_effect)
    patch.setattr(jobspy, "scrape_jobs", deny_effect)
    patch.setattr(time, "sleep", deny_effect)


def pytest_sessionstart(session):
    # Autouse fixtures alone would be too late for worker module globals.
    install_safety(_SESSION_PATCH)


def pytest_sessionfinish(session, exitstatus):
    _SESSION_PATCH.undo()


@pytest.fixture(autouse=True)
def offline_safety(monkeypatch):
    install_safety(monkeypatch)
    from utils import ai_reviewer, scraping
    from workers import worker_email, worker_schedule

    monkeypatch.setattr(scraping, "_jobspy_scrape_jobs", deny_effect)
    monkeypatch.setattr(ai_reviewer, "_rate_lock", asyncio.Lock())
    monkeypatch.setattr(ai_reviewer, "_last_call_time", 0.0)
    monkeypatch.setattr(ai_reviewer, "_blocked_until", 0.0)
    monkeypatch.setattr(worker_email.deduper, "supabase_url", None)
    monkeypatch.setattr(worker_email.deduper, "supabase_key", None)
    monkeypatch.setattr(worker_email.deduper, "service_key", None)
    monkeypatch.setattr(worker_email.deduper, "read_headers", {})
    monkeypatch.setattr(worker_email.deduper, "write_headers", {})
    monkeypatch.setattr(worker_schedule, "SUPABASE_URL", "")
    monkeypatch.setattr(worker_schedule, "SUPABASE_SERVICE_KEY", "")


class HttpEffects:
    """Exact method/host/path routing; query/payload assertions belong in tests."""

    def __init__(self):
        self.routes = {}
        self.requests = []
        self.clients = []

    def add(self, method, url, response):
        parsed = httpx.URL(url)
        self.routes[(method, parsed.host, parsed.path)] = response

    def handle(self, request):
        self.requests.append(request)
        route = self.routes.get((request.method, request.url.host, request.url.path))
        if route is None:
            pytest.fail(f"Unscripted HTTP request: {request.method} {request.url}")
        response = route(request) if callable(route) else route
        return response

    def client(self):
        client = httpx.AsyncClient(transport=httpx.MockTransport(self.handle))
        self.clients.append(client)
        return client


@pytest.fixture
async def http_effects(monkeypatch):
    from utils import scraping
    from workers import worker_email, worker_scrape

    effects = HttpEffects()
    for module in (scraping, worker_email, worker_scrape):
        monkeypatch.setattr(module, "create_stealth_client", lambda *a, **kw: effects.client())
    yield effects
    for client in effects.clients:
        await client.aclose()


@pytest.fixture
def supabase(monkeypatch):
    from utils.deduper import Deduper
    from workers import worker_email

    monkeypatch.setenv("SUPABASE_URL", "https://database.invalid")
    monkeypatch.setenv("SUPABASE_KEY", "offline-anon")
    monkeypatch.setenv("SUPABASE_SERVICE_KEY", "offline-service")
    deduper = Deduper()
    monkeypatch.setattr(worker_email, "deduper", deduper)
    return deduper


@pytest.fixture
def clock(monkeypatch):
    from utils import ai_reviewer

    clock = SimpleNamespace(now=100.0, sleeps=[])
    original_sleep = asyncio.sleep

    async def sleep(seconds):
        clock.sleeps.append(seconds)
        clock.now += seconds
        await original_sleep(0)

    def blocking_sleep(seconds):
        clock.sleeps.append(seconds)
        clock.now += seconds

    monkeypatch.setattr(ai_reviewer, "time", SimpleNamespace(monotonic=lambda: clock.now))
    monkeypatch.setattr(asyncio, "sleep", sleep)
    monkeypatch.setattr(time, "sleep", blocking_sleep)
    with time_machine.travel("2026-01-02T12:00:00Z", tick=False):
        yield clock


@pytest.fixture
def model_effects(monkeypatch, clock):
    """Script the SDK boundary, retaining real GenerateContentConfig types."""
    effects = SimpleNamespace(outcomes=deque(), calls=[], clients=[])

    def generate_content(**kwargs):
        effects.calls.append(kwargs)
        if not effects.outcomes:
            pytest.fail("Unscripted model call")
        result = effects.outcomes.popleft()
        if isinstance(result, Exception):
            raise result
        return SimpleNamespace(text=result)

    def client(**kwargs):
        instance = SimpleNamespace(
            models=SimpleNamespace(generate_content=generate_content),
            closed=False,
        )
        instance.close = lambda: setattr(instance, "closed", True)
        effects.clients.append(instance)
        return instance

    monkeypatch.setenv("GEMINI_API_KEY", "offline-model-key")
    monkeypatch.setattr(genai, "Client", client)
    return effects


@pytest.fixture
def jobspy_effects(monkeypatch, clock):
    from utils import scraping

    effects = SimpleNamespace(frames={}, calls=[])

    def scrape_jobs(**kwargs):
        effects.calls.append(kwargs)
        site = kwargs["site_name"][0]
        if site not in effects.frames:
            pytest.fail(f"Unscripted JobSpy site: {site}")
        result = effects.frames[site]
        if isinstance(result, Exception):
            raise result
        return result.copy() if isinstance(result, pd.DataFrame) else result

    monkeypatch.setattr(jobspy, "scrape_jobs", scrape_jobs)
    monkeypatch.setattr(scraping, "_jobspy_scrape_jobs", scrape_jobs)
    monkeypatch.setattr(scraping.random, "shuffle", lambda sites: None)
    monkeypatch.setattr(scraping.random, "uniform", lambda low, high: low)
    return effects


@pytest.fixture
def smtp_effects(monkeypatch, clock):
    effects = SimpleNamespace(messages=[], events=[], failures=deque(), connections=[], tls_context=None)

    class SMTP:
        def __init__(self, host, port, **options):
            effects.events.append(("connect", host, port))
            effects.connections.append(options)
            if effects.failures:
                raise effects.failures.popleft()

        def __enter__(self):
            return self

        def __exit__(self, *args):
            effects.events.append(("close",))

        def ehlo(self):
            effects.events.append(("ehlo",))

        def starttls(self, **options):
            effects.events.append(("starttls",))
            effects.tls_context = options.get("context")

        def login(self, user, password):
            assert (user, password) == ("sender@example.invalid", "offline-smtp")
            effects.events.append(("login",))

        def sendmail(self, sender, recipient, message):
            effects.messages.append((sender, recipient, message))
            return {}

    monkeypatch.setenv("SMTP_HOST", "smtp.invalid")
    monkeypatch.setenv("SMTP_USER", "sender@example.invalid")
    monkeypatch.setenv("SMTP_PASSWORD", "offline-smtp")
    monkeypatch.setattr(smtplib, "SMTP", SMTP)
    monkeypatch.setattr(smtplib, "SMTP_SSL", SMTP)
    return effects
