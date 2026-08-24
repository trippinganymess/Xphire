"""
Xphire Cron Scraper.

Runs every 30 minutes. Scrapes jobs for default titles across JobSpy and ATS.
Deduplicates against Supabase and enriches via AI.
Saves all new jobs to Supabase Seen_job table.
Does not send emails.
"""

import os
import asyncio
from typing import List, Dict, Any
from utils.ai_reviewer import enrich_jobs
from utils.deduper import Deduper
from utils.scraping import create_stealth_client, parse_proxy_list
from workers.worker_email import scrape_jobspy, scrape_ats

# Default titles to scrape periodically
DEFAULT_TITLES = [
    "Software Engineer",
    "Backend Developer",
    "Frontend Developer",
    "Data Engineer",
    "DevOps Engineer",
    "ML Engineer"
]

deduper = Deduper()

async def scrape_for_title(client, title: str, proxy_list: list):
    print(f"\n{'='*60}")
    print(f"[CRON] Scraping jobs for: {title}")
    print(f"{'='*60}")
    
    # 1. Scrape JobSpy + ATS
    scrape_task = asyncio.gather(
        scrape_jobspy(title, proxy_list, freshers_only=False),
        scrape_ats(client, title, freshers_only=False),
    )
    jobspy_results, ats_results = await scrape_task
    
    all_scraped = jobspy_results + ats_results
    if not all_scraped:
        print(f"[CRON] No jobs found for {title}.")
        return

    print(f"[CRON] Combined {len(jobspy_results)} JobSpy + {len(ats_results)} ATS = {len(all_scraped)} total scraped for {title}")

    # 2. Deduplicate against DB
    unseen = await deduper.get_unseen_jobs(client, all_scraped)
    if unseen:
        # 3. AI Enrich
        unseen = await enrich_jobs(unseen)
        # 4. Save to DB
        await deduper.save_seen_jobs(client, unseen)
        print(f"[CRON] Saved {len(unseen)} new jobs for {title}.")
    else:
        print(f"[CRON] All scraped jobs for {title} already in DB.")

async def main():
    proxy_list = parse_proxy_list()
    
    async with create_stealth_client() as client:
        # Run sequentially to not hammer APIs and proxies too hard
        for title in DEFAULT_TITLES:
            await scrape_for_title(client, title, proxy_list)
            # Add a small delay between titles
            await asyncio.sleep(10)
            
    print("\n[CRON] Complete.")

if __name__ == "__main__":
    asyncio.run(main())
