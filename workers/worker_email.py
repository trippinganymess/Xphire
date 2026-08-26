"""
Xphire Unified Email Pipeline.

Single worker that:
  1. Parses search inputs (job_title, recipient_email, freshers_only, min_stars)
  2. Checks the Supabase cache for recent matching results (< 6h old, min_stars, freshers_only)
  3. If cache misses, scrapes via JobSpy (Google Jobs, LinkedIn, Indeed)
     AND via direct ATS APIs (Greenhouse, Lever, Ashby, SmartRecruiters)
  4. Deduplicates against Supabase
  5. Enriches via Gemini AI (rating 1-5, location, experience, salary)
  6. Filters by minimum star rating & fresher status
  7. Sends a styled HTML email digest

Designed to run entirely on GitHub Actions (ubuntu-latest).
"""

import os
import asyncio
import random
import pandas as pd
from typing import List, Dict, Any

from utils.ai_reviewer import enrich_jobs
from utils.deduper import Deduper
from utils.emailer import build_html_email, send_email
from utils.scraping import (
    build_google_search_term,
    create_stealth_client,
    df_to_job_dicts,
    filter_mass_recruiters,
    human_delay,
    parse_proxy_list,
    scrape_jobspy,
    scrape_ats,
    is_fresher_job,
    CACHE_HOURS,
)

# ============================================================================
# CONFIG
# ============================================================================
MAX_EMAIL_JOBS  = 20

deduper = Deduper()

# ============================================================================
# CACHE LOOKUP
# ============================================================================
async def check_db_cache(
    client,
    title: str,
    freshers_only: bool = False,
    min_stars: int = 1,
    limit: int = 60,
) -> list:
    if not deduper.supabase_url or not deduper.supabase_key:
        return []

    encoded = title.replace(" ", "%20")
    rating_filter = f"&rating=gte.{min_stars}" if min_stars > 1 else ""
    url = (
        f"{deduper.supabase_url.rstrip('/')}/rest/v1/Seen_job"
        f"?select=company,title,url,location,experience,salary,source,rating"
        f"&title=ilike.*{encoded}*"
        f"{rating_filter}"
        f"&scraped_at=gte.{_hours_ago_iso(CACHE_HOURS)}"
        f"&order=rating.desc"
        f"&limit={limit}"
    )
    try:
        resp = await client.get(url, headers=deduper.read_headers, timeout=10.0)
        if resp.status_code == 200:
            rows = resp.json()
            if freshers_only and rows:
                rows = [r for r in rows if is_fresher_job(r)]
            if rows:
                print(f"[CACHE] {len(rows)} cached jobs found for '{title}' (≥{min_stars}★, < {CACHE_HOURS}h old)")
                return rows
    except Exception as exc:
        print(f"[CACHE] Query failed: {exc}")

    print(f"[CACHE] No cached results for '{title}'.")
    return []


def _hours_ago_iso(hours: int) -> str:
    from datetime import datetime, timezone, timedelta
    dt = datetime.now(timezone.utc) - timedelta(hours=hours)
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


# ============================================================================
# MAIN PIPELINE
# ============================================================================
async def main():
    job_title         = os.environ.get("JOB_TITLE", "").strip()
    recipient_email   = os.environ.get("RECIPIENT_EMAIL", "").strip()
    freshers_only_raw = os.environ.get("FRESHERS_ONLY", "false").strip().lower()
    freshers_only     = freshers_only_raw in ("true", "1", "yes")

    try:
        min_stars = int(os.environ.get("MIN_STARS", "3").strip() or "3")
        min_stars = max(1, min(5, min_stars))
    except ValueError:
        min_stars = 3

    if not job_title:
        print("[ERROR] JOB_TITLE env var is required.")
        return
    if not recipient_email:
        print("[ERROR] RECIPIENT_EMAIL env var is required.")
        return

    print("=" * 60)
    print(f"  Xphire Unified Pipeline")
    print(f"  Title        : {job_title}")
    print(f"  Recipient    : {recipient_email}")
    print(f"  Freshers Only: {freshers_only}")
    print(f"  Min Stars    : {min_stars}★")
    print("=" * 60)

    proxy_list = parse_proxy_list()

    # MAX backfill candidates to pull from cache (3× the email quota)
    MAX_CACHE_BACKFILL = MAX_EMAIL_JOBS * 3

    async with create_stealth_client() as client:
        # -- Step 1 & 2: Parallel — cache lookup + live scrapers ----------
        print("\n[PIPELINE] Running cache lookup and live scrapers in parallel...")
        cache_task = check_db_cache(
            client,
            job_title,
            freshers_only=freshers_only,
            min_stars=min_stars,
            limit=MAX_CACHE_BACKFILL,
        )
        scrape_task = asyncio.gather(
            scrape_jobspy(job_title, proxy_list, freshers_only=freshers_only),
            scrape_ats(client, job_title, freshers_only=freshers_only),
        )
        cache_jobs, (jobspy_results, ats_results) = await asyncio.gather(cache_task, scrape_task)

        # -- Step 3: Dedup new scraped jobs against DB, enrich & save -----
        all_scraped = jobspy_results + ats_results
        new_jobs: List[Dict[str, Any]] = []

        if all_scraped:
            print(f"\n[PIPELINE] Combined {len(jobspy_results)} JobSpy + {len(ats_results)} ATS = {len(all_scraped)} total scraped")
            unseen = await deduper.get_unseen_jobs(client, all_scraped)
            if unseen:
                # -- Step 4: AI Reviewer & Enrichment ---------------------
                unseen = await enrich_jobs(unseen)
                await deduper.save_seen_jobs(client, unseen)
                new_jobs = unseen
            else:
                print("[PIPELINE] All scraped jobs already in DB. Using cache backfill only.")
        else:
            print("[PIPELINE] No jobs returned from live scrapers. Using cache backfill only.")

        # -- Step 5: Hybrid merge — fresh scraped first, cache fills rest --
        seen_urls = {j.get("url", "") for j in new_jobs if j.get("url")}
        cache_backfill = [j for j in cache_jobs if j.get("url", "") not in seen_urls]

        # Sort each pool by rating descending
        new_jobs_sorted    = sorted(new_jobs,       key=lambda j: int(j.get("rating", 3) or 3), reverse=True)
        cache_backfill_sorted = sorted(cache_backfill, key=lambda j: int(j.get("rating", 3) or 3), reverse=True)

        jobs = new_jobs_sorted + cache_backfill_sorted
        print(
            f"\n[PIPELINE] Hybrid pool: {len(new_jobs_sorted)} fresh + "
            f"{len(cache_backfill_sorted)} cache backfill = {len(jobs)} total"
        )

        # -- Step 6: Post-enrichment filtering (Freshers & Min Stars) -----
        if freshers_only:
            before = len(jobs)
            jobs = [j for j in jobs if is_fresher_job(j)]
            print(f"[FILTER] Freshers filter: {before} -> {len(jobs)} jobs")

        if min_stars > 1:
            before = len(jobs)
            jobs = [j for j in jobs if int(j.get("rating", 3) or 3) >= min_stars]
            print(f"[FILTER] Rating >= {min_stars}★ filter: {before} -> {len(jobs)} jobs")

    if not jobs:
        print("[PIPELINE] No jobs found from any source. Nothing to email.")
        return

    # -- Step 7: Build and send email ------------------------------------
    top_jobs = jobs[:MAX_EMAIL_JOBS]
    print(f"\n[EMAIL] Building digest for {len(top_jobs)} jobs (quota: {MAX_EMAIL_JOBS})...")

    html = build_html_email(
        top_jobs,
        job_title,
        freshers_only=freshers_only,
        min_stars=min_stars,
    )
    badge_str = " (Freshers Only)" if freshers_only else ""
    subject = f"🚀 {len(top_jobs)} {job_title} Roles{badge_str} · {min_stars}+ ⭐ · Xphire AI"

    send_email(html, subject, recipient_email)
    print("\n[COMPLETE] Unified pipeline finished successfully.")


if __name__ == "__main__":
    asyncio.run(main())
