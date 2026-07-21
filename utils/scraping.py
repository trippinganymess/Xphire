"""
Shared scraping utilities for all FreshLab workers.

Centralises: stealth HTTP client, Google Sheets posting, mass-recruiter
blocklist, proxy parsing, humanised pacing, and Google search term building.
"""

import os
import random
import asyncio
import httpx
import pandas as pd
from typing import List, Optional

# ============================================================================
# USER-AGENT ROTATION POOL
# ============================================================================
# Real-world UA strings from recent Chrome / Firefox / Safari releases.
# One is picked at random per httpx client session so consecutive requests
# don't share an identical fingerprint.
_USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:128.0) Gecko/20100101 Firefox/128.0",
    "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0",
]


def get_random_user_agent() -> str:
    """Return a randomly-selected real-world User-Agent string."""
    return random.choice(_USER_AGENTS)


# ============================================================================
# STEALTH HTTP CLIENT FACTORY
# ============================================================================
def create_stealth_client(proxy: Optional[str] = None) -> httpx.AsyncClient:
    """
    Build an httpx.AsyncClient that mimics a real browser.

    - Rotated User-Agent per session
    - Realistic Accept / Accept-Language / DNT headers
    - Bounded connection pool to avoid hammering targets
    """
    headers = {
        "User-Agent": get_random_user_agent(),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,application/json,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "DNT": "1",
        "Connection": "keep-alive",
        "Upgrade-Insecure-Requests": "1",
    }

    pool_limits = httpx.Limits(
        max_connections=20,
        max_keepalive_connections=10,
    )

    return httpx.AsyncClient(
        headers=headers,
        limits=pool_limits,
        proxy=proxy,
        follow_redirects=True,
        timeout=httpx.Timeout(15.0, connect=10.0),
    )


# ============================================================================
# PROXY PARSING
# ============================================================================
def parse_proxy_list() -> Optional[List[str]]:
    """
    Read PROXY_URL env var.  Supports a single proxy or a comma-separated
    list for round-robin.  Returns None when unset.
    """
    proxy_url = os.environ.get("PROXY_URL")
    if not proxy_url:
        return None
    return [p.strip() for p in proxy_url.split(",") if p.strip()]


# ============================================================================
# GOOGLE SEARCH TERM BUILDER
# ============================================================================
# Google Jobs ignores search_term/location/hours_old entirely once you pass
# google_search_term.  It only understands natural-language text that looks
# like what Google's own Jobs search box would generate.
#
# To add a *verified* override for a title: search "{title} jobs" on
# google.com, open the Jobs panel, apply filters, and copy the text that
# appears in the panel's OWN search box (not the main Google search bar).
GOOGLE_QUERY_OVERRIDES: dict = {
    # "Software Engineer": "paste the verified string from Google Jobs here",
}


def build_google_search_term(title: str) -> str:
    """Build the natural-language query Google Jobs expects."""
    if title in GOOGLE_QUERY_OVERRIDES:
        return GOOGLE_QUERY_OVERRIDES[title]
    return f"{title} jobs near India since yesterday"


# ============================================================================
# MASS-RECRUITER BLOCKLIST
# ============================================================================
MASS_RECRUITERS = [
    "tcs", "tata consultancy services", "infosys", "wipro",
    "cognizant", "accenture", "capgemini", "tech mahindra",
    "hcl", "l&t", "larsen & toubro", "ibm",
]

_MASS_RECRUITER_PATTERN = "|".join(MASS_RECRUITERS)


def filter_mass_recruiters(df: pd.DataFrame) -> pd.DataFrame:
    """Remove rows whose 'company' column matches the blocklist."""
    before = len(df)
    df = df[~df["company"].str.contains(
        _MASS_RECRUITER_PATTERN, case=False, na=False, regex=True
    )]
    print(f"Mass-recruiter filter: {before} → {len(df)} jobs")
    return df


# ============================================================================
# HUMANISED PACING
# ============================================================================
# Per-site delay ranges (seconds).
SITE_DELAY_RANGES = {
    "linkedin": (5, 12),
    "indeed":   (5, 12),
    "google":   (5, 12),
}


async def human_delay(site: str, is_between_titles: bool = False):
    """
    Sleep for a randomised, human-plausible interval.

    - Between sites for the same title: uses SITE_DELAY_RANGES.
    - Between titles: longer 15-35 s pause.
    """
    if is_between_titles:
        pause = random.uniform(15, 35)
        print(f"Pausing {pause:.1f}s before next profile...")
        await asyncio.sleep(pause)
    else:
        low, high = SITE_DELAY_RANGES.get(site, (5, 12))
        delay = random.uniform(low, high)
        print(f"Waiting {delay:.1f}s before next request...")
        await asyncio.sleep(delay)


# ============================================================================
# GOOGLE SHEETS POSTER
# ============================================================================
async def send_batch_to_google_sheet(
    client: httpx.AsyncClient,
    jobs_to_log: pd.DataFrame,
    default_role: str = "Software Role",
):
    """
    Push a DataFrame of jobs to Google Sheets via a Google Form.

    Uses httpx instead of aiohttp for consistency with the rest of the
    pipeline.  Concurrency is capped at 5 to stay polite.
    """
    form_url = os.environ.get("GOOGLE_FORM_URL")
    entry_company = os.environ.get("GOOGLE_ENTRY_COMPANY")
    entry_title = os.environ.get("GOOGLE_ENTRY_TITLE")
    entry_link = os.environ.get("GOOGLE_ENTRY_LINK")

    if not all([form_url, entry_company, entry_title, entry_link]):
        print("[WARN] Google Form env vars incomplete — skipping sheet sync.")
        return

    print(f"\nPushing {len(jobs_to_log)} curated entries to Google Sheets...")

    semaphore = asyncio.Semaphore(5)

    async def _post_row(row):
        comp = row["company"] if pd.notna(row.get("company")) else "Hidden Company"
        role = row["title"] if pd.notna(row.get("title")) else default_role
        link = row.get("job_url", row.get("url", ""))
        if pd.isna(link):
            link = ""

        payload = {
            entry_company: comp,
            entry_title: role,
            entry_link: link,
        }

        async with semaphore:
            try:
                resp = await client.post(form_url, data=payload, timeout=10.0)
                if resp.status_code not in (200, 201):
                    print(f"Failed to log entry for {comp}. Status: {resp.status_code}")
            except Exception as e:
                print(f"Network error syncing entry for {comp}: {e}")

    tasks = [_post_row(row) for _, row in jobs_to_log.iterrows()]
    await asyncio.gather(*tasks)


# ============================================================================
# DATAFRAME ↔ DICT BRIDGE  (for Deduper integration with JobSpy workers)
# ============================================================================
def df_to_job_dicts(df: pd.DataFrame) -> list[dict]:
    """
    Convert a JobSpy DataFrame into the List[Dict] format the Deduper expects.

    Maps the 'id' column → 'job_id', and carries 'company', 'title', 'job_url'.
    """
    records = []
    for _, row in df.iterrows():
        records.append({
            "job_id": str(row.get("id", "")),
            "company": str(row.get("company", "")),
            "title": str(row.get("title", "")),
            "url": str(row.get("job_url", "")),
        })
    return records


def filter_df_by_unseen(df: pd.DataFrame, unseen_ids: set) -> pd.DataFrame:
    """Keep only DataFrame rows whose 'id' is in the unseen set."""
    return df[df["id"].isin(unseen_ids)].copy()
