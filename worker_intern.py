import os
import asyncio
import random
import pandas as pd
from jobspy import scrape_jobs

from utils.deduper import Deduper
from utils.scraping import (
    build_google_search_term,
    create_stealth_client,
    df_to_job_dicts,
    filter_df_by_unseen,
    filter_mass_recruiters,
    human_delay,
    parse_proxy_list,
    send_batch_to_google_sheet,
)

# Internship-focused sibling of worker.py. Same scraping / pacing / dedup /
# Google Sheet posting machinery - see that file for the full reasoning
# behind site selection, delay ranges, and the Google Jobs query quirks.
# The differences here are: intern-specific search titles, a job_type
# filter, a wider default lookback window, and a post-scrape title check
# as a safety net for that filter.

COUNTRY_INDEED = "India"

# JobSpy's native job_type filter. Confirmed to exist and to be passed
# through to indeed/linkedin/google, but NOT confirmed to be honored
# identically by every one of those sites - Indeed and LinkedIn respect it
# reasonably reliably in practice, Google Jobs' behavior depends entirely
# on whatever google_search_term produces (below). That's why there's also
# a text-based filter on the title after scraping - it's a safety net for
# this param, not a duplicate of it.
JOB_TYPE = "internship"

# Internship postings trickle in slower than full-time reqs, and this
# workflow only runs on manual dispatch (no schedule), so the lookback
# window is wider than worker.py's hours_old=6 to avoid missing postings
# between runs. Tighten this if you end up running the workflow more often
# than every few days.
HOURS_OLD = 72

# Ask for a bit more per (site, title) pair than worker.py does, since the
# job_type filter narrows the pool before results_wanted is applied.
RESULTS_WANTED = 15

MAX_JOBS_PER_RUN = 70

deduper = Deduper()


async def async_scrape_target(site: str, title: str, proxy_list: list) -> pd.DataFrame:
    print(f"Scraping [{site}] for internship profile: '{title}'...")
    try:
        jobs_df = await asyncio.to_thread(
            scrape_jobs,
            site_name=[site],
            search_term=title,
            google_search_term=build_google_search_term(title),
            location="India",
            country_indeed=COUNTRY_INDEED,
            job_type=JOB_TYPE,
            results_wanted=RESULTS_WANTED,
            hours_old=HOURS_OLD,
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
    print("Initializing Human-Paced Internship Scraper Pipeline...")
    try:
        import jobspy
        print(f"python-jobspy version: {jobspy.__version__}")
    except Exception:
        pass  # version not exposed on this build, not worth failing over

    search_titles = [
        "Software Engineer Intern",
        "Software Development Intern",
        "Backend Engineer Intern",
        "Frontend Engineer Intern",
        "Full Stack Engineer Intern",
        "Machine Learning Intern",
        "AI Intern",
        "Data Science Intern",
    ]

    # Same site set and same exclusions as worker.py (naukri/bayt/glassdoor
    # dropped - see that file's comments for why).
    scrapers = ["google", "linkedin", "indeed"]

    proxy_list = parse_proxy_list()

    all_scraped_jobs = []

    titles_order = search_titles.copy()
    random.shuffle(titles_order)

    for i, title in enumerate(titles_order):
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
        print("No active internship listings discovered across target criteria.")
        return

    combined_df = pd.concat(all_scraped_jobs, ignore_index=True)
    combined_df = combined_df.drop_duplicates(subset=["id"])

    # Safety-net filter: job_type="internship" above isn't guaranteed to be
    # honored by every site/scraper, so anything that slipped through
    # without "intern" in the title gets dropped here. Broaden the regex
    # (e.g. "intern|co-op|trainee") if you want to catch adjacent titles.
    print(f"Jobs before internship title filter: {len(combined_df)}")
    combined_df = combined_df[combined_df["title"].str.contains("intern", case=False, na=False)]
    print(f"Jobs remaining after internship title filter: {len(combined_df)}")

    if combined_df.empty:
        print("No listings survived the internship title filter.")
        return

    combined_df = combined_df.sample(frac=1).reset_index(drop=True)

    print(f"\nTotal jobs before filtering mass recruiters: {len(combined_df)}")
    combined_df = filter_mass_recruiters(combined_df)

    if combined_df.empty:
        print("All scraped internships were caught by the recruiter filter.")
        return

    # --- Deduplication via shared Deduper (httpx) ---
    async with create_stealth_client() as client:
        job_dicts = df_to_job_dicts(combined_df)
        unseen_jobs = await deduper.get_unseen_jobs(client, job_dicts)

        if not unseen_jobs:
            print("No net-new internship postings found since last execution window.")
            return

        unseen_ids = {j["job_id"] for j in unseen_jobs}
        new_jobs_df = filter_df_by_unseen(combined_df, unseen_ids)

        print(f"Discovered {len(new_jobs_df)} total new internships.")
        top_batch = new_jobs_df.head(MAX_JOBS_PER_RUN)

        await send_batch_to_google_sheet(client, top_batch, default_role="Internship Role")
        await deduper.save_seen_jobs(client, unseen_jobs[:MAX_JOBS_PER_RUN])

    print("\nInternship pipeline execution complete. Vault successfully updated.")


if __name__ == "__main__":
    asyncio.run(main())