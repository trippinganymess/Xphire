"""
Gemini AI enrichment module for the Xphire pipeline.

For every new (unseen) job, queries Gemini to extract:
  - rating     : company quality score (integer 1-5)
  - location   : standardised location string
  - experience : standardised experience level
  - salary     : compensation / stipend details

Falls back gracefully if GEMINI_API_KEY is absent or any individual
call fails/times out.
"""

import os
import json
import asyncio
import time
import re
from typing import Any, Dict, List, Optional

from google import genai
from google.genai import types

# ---------------------------------------------------------------------------
# Fallback values applied whenever Gemini cannot be reached or returns bad JSON
# ---------------------------------------------------------------------------
_FALLBACK: Dict[str, Any] = {
    "rating": 3,
    "location": "India",
    "experience": "Not Specified",
    "salary": "Not Disclosed",
}

# ---------------------------------------------------------------------------
# Prompt template
# ---------------------------------------------------------------------------
_PROMPT = """\
You are a strict job market analyst for the Indian tech industry.
Evaluate the job posting below and return ONLY a valid JSON object - no markdown, no code fences, no explanation.

Company: {company}
Title: {title}
Description: {description}

Required JSON keys:
- "rating": integer 1-5
    1 = suspicious / body-shopping / mass-recruiter
    2 = below-average startup or consulting shop
    3 = average funded startup or mid-size product company
    4 = strong product company (Series B+, well-known, or listed)
    5 = top-tier / FAANG / unicorn
- "location": extracted or standardised string (e.g. "Bengaluru / Remote", "Remote", "Mumbai", "India")
- "experience": standardised level (e.g. "Fresher / 0-1 Yrs", "1-3 Yrs", "3-5 Yrs", "5+ Yrs")
- "salary": stipend or CTC if mentioned, else "Not Disclosed" (e.g. "₹45,000/mo", "₹8-12 LPA")
"""

# ---------------------------------------------------------------------------
# Gemini config - JSON mode, low temperature for deterministic extraction
# ---------------------------------------------------------------------------
_GENERATION_CONFIG = types.GenerateContentConfig(
    response_mime_type="application/json",
    temperature=0.1,
)


# Models to try in order of preference: Gemini 3.5 Flash Lite -> Gemini 3.1 Flash Lite -> Gemma 4 31B
_MODEL_CANDIDATES = [
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite",
    "gemma-4-31b-it",
]

# ---------------------------------------------------------------------------
# Rate limiter – ensures we stay below 30 RPM (1 call every 2 seconds)
# ---------------------------------------------------------------------------
_rate_lock = asyncio.Lock()
_last_call_time = 0.0
_blocked_until = 0.0
_MIN_INTERVAL = 2.1  # modest buffer below the 30 RPM free-tier ceiling
_RETRY_BUFFER = 1.0


async def _rate_limit() -> None:
    """Wait until at least _MIN_INTERVAL seconds have passed since the last API call."""
    global _last_call_time
    async with _rate_lock:
        now = time.monotonic()
        next_call_at = max(_last_call_time + _MIN_INTERVAL, _blocked_until)
        if now < next_call_at:
            await asyncio.sleep(next_call_at - now)
        _last_call_time = time.monotonic()


async def _apply_rate_limit_cooldown(delay: float) -> float:
    """Pause this request and all queued requests for the server delay plus a buffer."""
    global _blocked_until
    wait_seconds = max(0.0, delay) + _RETRY_BUFFER
    async with _rate_lock:
        _blocked_until = max(_blocked_until, time.monotonic() + wait_seconds)
    await asyncio.sleep(wait_seconds)
    return wait_seconds


# ---------------------------------------------------------------------------
# Helper: extract retryDelay from a 429 error response
# ---------------------------------------------------------------------------
def _extract_retry_delay(exc: Exception) -> Optional[float]:
    """Try to parse a retry delay (in seconds) from a Google API error response."""
    try:
        resp = getattr(exc, "response", None)

        # Attempt to read JSON body
        body = None
        if hasattr(resp, "json"):
            try:
                body = resp.json()
            except Exception:
                pass
        elif isinstance(resp, dict):
            body = resp

        if isinstance(body, dict):
            error_info = body.get("error", {})
            details = error_info.get("details", [])
            for detail in details:
                if isinstance(detail, dict):
                    retry_delay = detail.get("retryDelay")
                    if retry_delay is not None:
                        if isinstance(retry_delay, str):
                            match = re.match(r"\s*(\d+(?:\.\d+)?)s", retry_delay)
                            if match:
                                return float(match.group(1))
                        elif isinstance(retry_delay, (int, float)):
                            return float(retry_delay)

        # Fallback: check Retry-After header
        if hasattr(resp, "headers"):
            retry_after = resp.headers.get("Retry-After")
            if retry_after:
                try:
                    return float(retry_after)
                except ValueError:
                    pass
    except Exception:
        pass
    # google-genai exceptions often stringify the structured error while not
    # exposing the response object.  Preserve the server-provided delay.
    match = re.search(r"retryDelay['\"]?\s*:\s*['\"]?(\d+(?:\.\d+)?)s", str(exc))
    if match:
        return float(match.group(1))
    return None


# ---------------------------------------------------------------------------
# Internal: rate a single job with the Gemini model
# ---------------------------------------------------------------------------
async def _enrich_single(
    client: genai.Client,
    job: Dict[str, Any],
    semaphore: asyncio.Semaphore,
) -> Dict[str, Any]:
    """Call Gemini for one job dict and merge the result in-place."""
    company = str(job.get("company") or "Unknown")
    title = str(job.get("title") or "Unknown")
    # Cap description length to avoid token waste (~750 tokens)
    description = str(job.get("description") or "Not available")[:3000]

    prompt = _PROMPT.format(company=company, title=title, description=description)

    MAX_RETRIES = 3
    BASE_DELAY = 1.0  # seconds

    async with semaphore:
        success = False
        last_error = None

        for model_name in _MODEL_CANDIDATES:
            for attempt in range(1, MAX_RETRIES + 1):
                try:
                    await _rate_limit()
                    resp = await asyncio.to_thread(
                        client.models.generate_content,
                        model=model_name,
                        contents=prompt,
                        config=_GENERATION_CONFIG,
                    )
                    parsed: Dict[str, Any] = json.loads(resp.text)

                    rating = max(1, min(5, int(parsed.get("rating", 3))))
                    job["rating"] = rating
                    job["location"] = str(
                        parsed.get("location") or job.get("location") or _FALLBACK["location"]
                    )
                    job["experience"] = str(parsed.get("experience") or _FALLBACK["experience"])
                    job["salary"] = str(parsed.get("salary") or _FALLBACK["salary"])

                    stars = "⭐" * rating
                    print(f"  [AI {stars}] {company}: {title} (via {model_name})")
                    success = True
                    break
                except Exception as exc:
                    last_error = exc
                    err_str = str(exc)

                    is_rate_limit = "429" in err_str or "RESOURCE_EXHAUSTED" in err_str
                    if is_rate_limit:
                        retry_delay = _extract_retry_delay(exc)
                        if retry_delay is None:
                            retry_delay = BASE_DELAY * (2 ** (attempt - 1))
                        wait_seconds = retry_delay + _RETRY_BUFFER
                        print(
                            f"  [AI rate limit] {company} - {title}: "
                            f"retrying in {wait_seconds:.1f}s (attempt {attempt}/{MAX_RETRIES})"
                        )
                        await _apply_rate_limit_cooldown(retry_delay)
                        continue  # retry same model
                    else:
                        # Non-rate-limit error – move to next model immediately
                        break

            if success:
                break

        if not success:
            print(f"  [AI fallback] {company} - {title}: {last_error}")
            job.setdefault("rating", _FALLBACK["rating"])
            job.setdefault("location", job.get("location") or _FALLBACK["location"])
            job.setdefault("experience", _FALLBACK["experience"])
            job.setdefault("salary", _FALLBACK["salary"])

    return job


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------
async def enrich_jobs(jobs: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Enrich a list of job dicts with AI-generated metadata.

    Mutates each dict in-place, adding/overwriting:
      rating, location, experience, salary

    Falls back gracefully when GEMINI_API_KEY is missing or any
    individual call fails.

    Args:
        jobs: List of job dicts (must have at least 'company' and 'title').

    Returns:
        The same list with enriched fields merged in.
    """
    if not jobs:
        return jobs

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("[AI] GEMINI_API_KEY not set - applying fallback values to all jobs.")
        for job in jobs:
            job.setdefault("rating", _FALLBACK["rating"])
            job.setdefault("location", job.get("location") or _FALLBACK["location"])
            job.setdefault("experience", _FALLBACK["experience"])
            job.setdefault("salary", _FALLBACK["salary"])
        return jobs

    client = genai.Client(api_key=api_key)
    # 5 concurrent Gemini calls - stays well within free-tier rate limits
    semaphore = asyncio.Semaphore(5)

    print(f"\n[AI] Enriching {len(jobs)} new job(s) via Gemini AI pipeline...")
    tasks = [_enrich_single(client, job, semaphore) for job in jobs]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    enriched: List[Dict[str, Any]] = []
    for job, result in zip(jobs, results):
        if isinstance(result, Exception):
            # gather() swallowed an unhandled exception - apply fallback
            print(f"  [AI gather error] {job.get('company')}: {result}")
            job.setdefault("rating", _FALLBACK["rating"])
            job.setdefault("location", job.get("location") or _FALLBACK["location"])
            job.setdefault("experience", _FALLBACK["experience"])
            job.setdefault("salary", _FALLBACK["salary"])
            enriched.append(job)
        else:
            enriched.append(result)

    return enriched
