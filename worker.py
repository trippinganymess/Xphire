import os
import asyncio
import random
import pandas as pd
from jobspy import scrape_jobs

from utils.ai_reviewer import enrich_jobs
from utils.deduper import Deduper
from utils.scraping import (
    build_google_search_term,
    create_stealth_client,
    df_to_job_dicts,
    filter_mass_recruiters,
    human_delay,
    parse_proxy_list,
    send_batch_to_google_sheet,
)

# JobSpy requires country_indeed for both Indeed AND Glassdoor - without it,
# Indeed silently returns nothing useful and Glassdoor errors out more often.
COUNTRY_INDEED = "India"

deduper = Deduper()


async def async_scrape_target(site: str, title: str, proxy_list: list) -> pd.DataFrame:
    print(f"Scraping [{site}] for profile: '{title}'...")
    try:
        jobs_df = await asyncio.to_thread(
            scrape_jobs,
            site_name=[site],
            search_term=title,
            # Google Jobs ignores `search_term` entirely and only listens to
            # this param - harmless to pass it for every site, non-Google
            # scrapers just ignore it.
            google_search_term=build_google_search_term(title),
            location="India",
            country_indeed=COUNTRY_INDEED,
            results_wanted=10,
            hours_old=6,
            proxies=proxy_list,
        )
        if jobs_df is not None and not jobs_df.empty:
            print(f"-> Success: Found {len(jobs_df)} roles on {site} for '{title}'")
            return jobs_df
        else:
            print(f"-> No roles returned by {site} for '{title}' (zero matches or soft-blocked)")
    except Exception as e:
        print(f"-> Skipped {site} for '{title}' (Likely blocked or errored): {e}")

    return pd.DataFrame()


async def main():
    print("Initializing Human-Paced Scraper Pipeline...")
    try:
        import jobspy
        print(f"python-jobspy version: {jobspy.__version__}")
    except Exception:
        pass  # version not exposed on this build, not worth failing over

    search_titles = [
        "Software Engineer",
        "Backend Engineer",
        "Machine Learning Engineer",
        "Data Scientist",
        "MLOps Engineer",
    ]

    # naukri, bayt, and glassdoor removed: all three were failing 100% of
    # the time regardless of delay (406 recaptcha / 403 forbidden / upstream
    # API error), so they were pure time cost with zero payoff. Re-add
    # naukri/bayt once you have proxies to pair with them; re-add glassdoor
    # once JobSpy patches the upstream bug.
    scrapers = ["google", "linkedin", "indeed"]

    proxy_list = parse_proxy_list()
    all_scraped_jobs = []

    # Shuffle title order so the pipeline doesn't always hit the same site
    # in the same sequence at the same offset every single run.
    titles_order = search_titles.copy()
    random.shuffle(titles_order)

    for i, title in enumerate(titles_order):
        # Shuffle site order per title — no more firing all requests to
        # every domain in the exact same instant, every 4 hours.
        site_order = scrapers.copy()
        random.shuffle(site_order)

        for j, site in enumerate(site_order):
            df = await async_scrape_target(site, title, proxy_list)
            if not df.empty:
                all_scraped_jobs.append(df)

            is_last_site = (j == len(site_order) - 1)
            is_last_title = (i == len(titles_order) - 1)
            if not (is_last_site and is_last_title):
                await human_delay(site)

        if i < len(titles_order) - 1:
            await human_delay(site, is_between_titles=True)

    if not all_scraped_jobs:
        print("No active listings discovered across target criteria.")
        return

    combined_df = pd.concat(all_scraped_jobs, ignore_index=True)
    combined_df = combined_df.drop_duplicates(subset=["id"])
    combined_df = combined_df.sample(frac=1).reset_index(drop=True)

    print(f"\nTotal jobs before filtering mass recruiters: {len(combined_df)}")
    combined_df = filter_mass_recruiters(combined_df)

    if combined_df.empty:
        print("All scraped jobs were caught by the recruiter filter.")
        return

    # ── Convert to common dict schema ─────────────────────────────────────────
    all_job_dicts = df_to_job_dicts(combined_df)

    async with create_stealth_client() as client:
        # ── Deduplication ──────────────────────────────────────────────────────
        unseen_jobs = await deduper.get_unseen_jobs(client, all_job_dicts)

        if not unseen_jobs:
            print("No net-new recent roles found since last execution window.")
            return

        # ── AI Enrichment ──────────────────────────────────────────────────────
        unseen_jobs = await enrich_jobs(unseen_jobs)

        top_70 = unseen_jobs[:70]
        print(f"\nDispatching {len(top_70)} enriched roles to Google Sheets...")

        # ── Google Sheets dispatch ─────────────────────────────────────────────
        await send_batch_to_google_sheet(client, top_70)

        # ── Persistence ────────────────────────────────────────────────────────
        await deduper.save_seen_jobs(client, top_70)

    print("\nPipeline execution complete. Vault successfully updated.")


if __name__ == "__main__":
    asyncio.run(main())