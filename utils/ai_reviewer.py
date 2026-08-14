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
from typing import Any, Dict, List

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

    async with semaphore:
        success = False
        last_error = None

        for model_name in _MODEL_CANDIDATES:
            try:
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
                if "429" in err_str or "RESOURCE_EXHAUSTED" in err_str:
                    # Model limit reached or model not available on free tier, try next candidate
                    continue
                else:
                    # Other error, try next candidate or fail to fallback
                    continue

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
