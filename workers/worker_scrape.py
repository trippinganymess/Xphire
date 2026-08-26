#!/usr/bin/env python3
"""
Cron worker that scrapes jobs, deduplicates, enriches, and stores them.
Runs every 30 minutes via GitHub Actions.
"""

import asyncio
import os
import sys
import time
from typing import Dict, List, Any

import httpx

# Adjust path so we can import repo utilities
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from utils.deduper import Deduper
from utils.ai_reviewer import enrich_jobs
from utils.scraping import scrape_jobspy, scrape_ats, parse_proxy_list, create_stealth_client

# ---------------------------------------------------------------------------
# Hard‑coded default search terms – used when SCRAPE_KEYWORDS is not set.
# ---------------------------------------------------------------------------
DEFAULT_KEYWORDS = [
    "Software Engineer",
    "Backend Developer",
    "Frontend Developer",
    "Data Engineer",
    "DevOps Engineer",
    "ML Engineer",
]


def get_keywords() -> List[str]:
    raw = os.environ.get("SCRAPE_KEYWORDS", "")
    if raw.strip():
        return [kw.strip() for kw in raw.split(",") if kw.strip()]
    return DEFAULT_KEYWORDS


async def scrape_keyword(keyword: str, client: httpx.AsyncClient) -> List[Dict[str, Any]]:
    """
    Scrape jobs for a single keyword using both JobSpy and ATS endpoints.
    """
    proxy_list = parse_proxy_list()

    # Run both scrapers concurrently
    jobspy_task = scrape_jobspy(keyword, proxy_list, freshers_only=False)
    ats_task = scrape_ats(client, keyword, freshers_only=False)

    jobspy_results, ats_results = await asyncio.gather(jobspy_task, ats_task, return_exceptions=True)

    combined: List[Dict[str, Any]] = []

    if isinstance(jobspy_results, Exception):
        print(f"[ERROR] JobSpy scrape for '{keyword}': {jobspy_results}")
    else:
        combined.extend(jobspy_results)

    if isinstance(ats_results, Exception):
        print(f"[ERROR] ATS scrape for '{keyword}': {ats_results}")
    else:
        combined.extend(ats_results)

    return combined


async def main():
    keywords = get_keywords()
    print(f"[SCRAPE] Keywords: {keywords}")

    # We reuse the same httpx client for all HTTP calls (Supabase, etc.)
    async with create_stealth_client() as http_client:
        deduper = Deduper()

        all_jobs: List[Dict[str, Any]] = []

        # 1. Scrape all keywords in parallel
        scrape_tasks = [scrape_keyword(kw, http_client) for kw in keywords]
        results = await asyncio.gather(*scrape_tasks, return_exceptions=True)

        for kw, res in zip(keywords, results):
            if isinstance(res, Exception):
                print(f"[ERROR] scraping keyword '{kw}': {res}")
            else:
                all_jobs.extend(res)

        print(f"[SCRAPE] Collected {len(all_jobs)} raw jobs")

        if not all_jobs:
            print("[SCRAPE] Nothing to process – exiting.")
            return

        # 2. Deduplicate via Supabase Seen_job
        unseen_jobs = await deduper.get_unseen_jobs(http_client, all_jobs)
        if not unseen_jobs:
            print("[SCRAPE] All jobs already seen – exiting.")
            return

        # 3. Enrich with Gemini AI
        enriched = await enrich_jobs(unseen_jobs)

        # 4. Persist to Supabase (no emails triggered)
        await deduper.save_seen_jobs(http_client, enriched)

        print("[SCRAPE] Pipeline finished successfully.")


if __name__ == "__main__":
    asyncio.run(main())
