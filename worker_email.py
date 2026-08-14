import os
import asyncio
import random
import pandas as pd
from jobspy import scrape_jobs

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
)

COUNTRY_INDEED  = "India"
CACHE_HOURS     = 6
MAX_EMAIL_JOBS  = 20
SCRAPERS        = ["google", "linkedin", "indeed"]

deduper = Deduper()


async def check_db_cache(client, title: str) -> list:
    if not deduper.supabase_url or not deduper.supabase_key:
        return []

    encoded = title.replace(" ", "%20")
    url = (
        f"{deduper.supabase_url.rstrip('/')}/rest/v1/Seen_job"
        f"?select=company,title,url,location,experience,salary,source,rating"
        f"&title=ilike.*{encoded}*"
        f"&scraped_at=gte.{_hours_ago_iso(CACHE_HOURS)}"
        f"&order=rating.desc"
        f"&limit=50"
    )
    try:
        resp = await client.get(url, headers=deduper.read_headers, timeout=10.0)
        if resp.status_code == 200:
            rows = resp.json()
            if rows:
                print(f"[CACHE] HIT — {len(rows)} cached jobs for '{title}' (< {CACHE_HOURS}h old)")
                return rows
    except Exception as exc:
        print(f"[CACHE] Query failed: {exc}")

    print(f"[CACHE] MISS — no fresh results for '{title}'. Running scraper...")
    return []


def _hours_ago_iso(hours: int) -> str:
    from datetime import datetime, timezone, timedelta
    dt = datetime.now(timezone.utc) - timedelta(hours=hours)
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


async def scrape_for_title(title: str, proxy_list: list) -> list:
    print(f"\n[SCRAPE] Starting scrape for '{title}' across {SCRAPERS}...")
    site_order = SCRAPERS.copy()
    random.shuffle(site_order)
    frames = []

    for j, site in enumerate(site_order):
        print(f"  Scraping [{site}]...")
        try:
            df = await asyncio.to_thread(
                scrape_jobs,
                site_name=[site],
                search_term=title,
                google_search_term=build_google_search_term(title),
                location="India",
                country_indeed=COUNTRY_INDEED,
                results_wanted=15,
                hours_old=CACHE_HOURS,
                proxies=proxy_list,
            )
            if df is not None and not df.empty:
                print(f"  -> {len(df)} results from {site}")
                frames.append(df)
            else:
                print(f"  -> No results from {site}")
        except Exception as exc:
            print(f"  -> Skipped {site}: {exc}")

        if j < len(site_order) - 1:
            await human_delay(site)

    if not frames:
        return []

    combined = pd.concat(frames, ignore_index=True).drop_duplicates(subset=["id"])
    combined = filter_mass_recruiters(combined)

    if combined.empty:
        return []

    return df_to_job_dicts(combined)


async def main():
    job_title       = os.environ.get("JOB_TITLE", "").strip()
    recipient_email = os.environ.get("RECIPIENT_EMAIL", "").strip()

    if not job_title:
        print("[ERROR] JOB_TITLE env var is required.")
        return
    if not recipient_email:
        print("[ERROR] RECIPIENT_EMAIL env var is required.")
        return

    print("=" * 60)
    print(f"  FreshLab Email Pipeline")
    print(f"  Title   : {job_title}")
    print(f"  Recipient: {recipient_email}")
    print("=" * 60)

    proxy_list = parse_proxy_list()

    async with create_stealth_client() as client:
        jobs = await check_db_cache(client, job_title)

        if not jobs:
            all_scraped = await scrape_for_title(job_title, proxy_list)

            if not all_scraped:
                print("[PIPELINE] No jobs found after scraping. Aborting.")
                return

            new_jobs = await deduper.get_unseen_jobs(client, all_scraped)

            if new_jobs:
                new_jobs = await enrich_jobs(new_jobs)
                await deduper.save_seen_jobs(client, new_jobs)
                jobs = new_jobs
            else:
                print("[PIPELINE] All scraped jobs already in DB. Fetching best from cache...")
                jobs = await check_db_cache(client, job_title) or all_scraped[:MAX_EMAIL_JOBS]

    if not jobs:
        print("[PIPELINE] Nothing to email.")
        return

    top_jobs = jobs[:MAX_EMAIL_JOBS]
    print(f"\n[EMAIL] Building digest for {len(top_jobs)} jobs...")

    html    = build_html_email(top_jobs, job_title)
    subject = f"🚀 {len(top_jobs)} {job_title} Roles · FreshLab AI"

    send_email(html, subject, recipient_email)
    print("\n[COMPLETE] Email pipeline finished.")


if __name__ == "__main__":
    asyncio.run(main())
