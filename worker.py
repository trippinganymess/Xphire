import os
import asyncio
import aiohttp
import random
import pandas as pd
from supabase import create_client, Client
from jobspy import scrape_jobs

SUPABASE_URL: str = os.environ.get("SUPABASE_URL")
SUPABASE_KEY: str = os.environ.get("SUPABASE_KEY")
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# JobSpy requires country_indeed for both Indeed AND Glassdoor - without it,
# Indeed silently returns nothing useful and Glassdoor errors out more often.
COUNTRY_INDEED = "India"

# Per-site delay ranges (seconds). Glassdoor gets a longer, wider gap since
# its scraper does a two-step token+GraphQL request under the hood; the more
# tolerant sites (linkedin/indeed/google) get shorter ones. This also
# naturally spaces out how often any single site sees a request per run.
#
# naukri and bayt have been dropped entirely (see `scrapers` list below) -
# their errors were unconditional regardless of delay, so there was no point
# paying the pacing time cost on them.
SITE_DELAY_RANGES = {
    "glassdoor": (10, 24),
    "linkedin": (5, 12),
    "indeed": (5, 12),
    "google": (5, 12),
}

def get_seen_jobs(scraped_ids: list) -> set:
    if not scraped_ids:
        return set()
    try:
        response = supabase.table('Seen_job').select('job_id').in_('job_id', scraped_ids).execute()
        return {row['job_id'] for row in response.data}
    except Exception as e:
        print(f"Error querying deduplication vault: {e}")
        return set()

def save_seen_jobs(job_ids: list):
    if not job_ids:
        return
    data = [{"job_id": jid} for jid in job_ids]
    try:
        supabase.table('Seen_job').insert(data).execute()
    except Exception as e:
        print(f"Error updating historical vault: {e}")

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
            google_search_term=f"{title} jobs in India since yesterday",
            location="India",
            country_indeed=COUNTRY_INDEED,
            results_wanted=10,
            hours_old=6,
            proxies=proxy_list
        )
        if jobs_df is not None and not jobs_df.empty:
            print(f"-> Success: Found {len(jobs_df)} roles on {site} for '{title}'")
            return jobs_df
        else:
            # Previously this case was silent - zero-result runs looked
            # identical to "everything is fine". Now it's visible.
            print(f"-> No roles returned by {site} for '{title}' (zero matches or soft-blocked)")
    except Exception as e:
        print(f"-> Skipped {site} for '{title}' (Likely blocked or errored): {e}")

    return pd.DataFrame()

async def send_batch_to_google_sheet_async(jobs_to_log: pd.DataFrame):
    form_url = os.environ.get("GOOGLE_FORM_URL")
    entry_company = os.environ.get("GOOGLE_ENTRY_COMPANY")
    entry_title = os.environ.get("GOOGLE_ENTRY_TITLE")
    entry_link = os.environ.get("GOOGLE_ENTRY_LINK")

    print(f"\nPushing {len(jobs_to_log)} curated entries to Google Sheets concurrently...")

    semaphore = asyncio.Semaphore(5)

    async def post_to_form(session, row):
        comp = row['company'] if pd.notna(row['company']) else "Hidden Company"
        role = row['title'] if pd.notna(row['title']) else "Software Role"
        link = row['job_url'] if pd.notna(row['job_url']) else ""

        payload = {
            entry_company: comp,
            entry_title: role,
            entry_link: link
        }

        async with semaphore:
            try:
                async with session.post(form_url, data=payload) as response:
                    if response.status != 200:
                        print(f"Failed to log entry for {comp}. Status: {response.status}")
            except Exception as e:
                print(f"Network error syncing entry for {comp}: {e}")

    async with aiohttp.ClientSession() as session:
        tasks = [post_to_form(session, row) for _, row in jobs_to_log.iterrows()]
        await asyncio.gather(*tasks)

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
        "MLOps Engineer"
    ]

    # naukri and bayt removed: both were failing 100% of the time regardless
    # of delay (406 recaptcha / 403 forbidden), so they were pure time cost
    # with zero payoff. Re-add them once you have proxies to pair with them.
    scrapers = ["google", "linkedin", "indeed", "glassdoor"]

    # Supports a single proxy ("http://user:pass@host:port") or a
    # comma-separated list for JobSpy to round-robin through
    # ("proxy1,proxy2,proxy3"). Leave PROXY_URL unset to go direct.
    proxy_url = os.environ.get("PROXY_URL")
    proxy_list = [p.strip() for p in proxy_url.split(",")] if proxy_url else None

    all_scraped_jobs = []

    # Shuffle title order too, so the pipeline doesn't always hit the same
    # site in the same sequence at the same offset every single run.
    titles_order = search_titles.copy()
    random.shuffle(titles_order)

    for i, title in enumerate(titles_order):
        # Shuffle site order per title - no more firing all 6 requests to
        # 6 different domains in the exact same instant, every 4 hours.
        site_order = scrapers.copy()
        random.shuffle(site_order)

        for j, site in enumerate(site_order):
            df = await async_scrape_target(site, title, proxy_list)
            if not df.empty:
                all_scraped_jobs.append(df)

            is_last_site = (j == len(site_order) - 1)
            is_last_title = (i == len(titles_order) - 1)
            if not (is_last_site and is_last_title):
                low, high = SITE_DELAY_RANGES.get(site, (5, 12))
                delay = random.uniform(low, high)
                print(f"Waiting {delay:.1f}s before next request...")
                await asyncio.sleep(delay)

        if i < len(titles_order) - 1:
            pause = random.uniform(15, 35)
            print(f"Finished '{title}'. Pausing {pause:.1f}s before next profile...")
            await asyncio.sleep(pause)

    if not all_scraped_jobs:
        print("No active listings discovered across target criteria.")
        return

    combined_df = pd.concat(all_scraped_jobs, ignore_index=True)
    combined_df = combined_df.drop_duplicates(subset=['id'])
    combined_df = combined_df.sample(frac=1).reset_index(drop=True)

    print(f"\nTotal jobs before filtering mass recruiters: {len(combined_df)}")
    mass_recruiters = [
        "tcs", "tata consultancy services", "infosys", "wipro",
        "cognizant", "accenture", "capgemini", "tech mahindra",
        "hcl", "l&t", "larsen & toubro", "ibm"
    ]
    pattern = '|'.join(mass_recruiters)
    combined_df = combined_df[~combined_df['company'].str.contains(pattern, case=False, na=False, regex=True)]
    print(f"Jobs remaining after blocklist applied: {len(combined_df)}")

    if combined_df.empty:
        print("All scraped jobs were caught by the recruiter filter.")
        return

    scraped_ids = combined_df['id'].tolist()
    seen_jobs = get_seen_jobs(scraped_ids)
    new_jobs = combined_df[~combined_df['id'].isin(seen_jobs)]

    if new_jobs.empty:
        print("No net-new recent roles found since last execution window.")
        return

    print(f"Discovered {len(new_jobs)} total new roles.")
    top_70 = new_jobs.head(70)

    await send_batch_to_google_sheet_async(top_70)

    save_seen_jobs(top_70['id'].tolist())
    print("\nPipeline execution complete. Vault successfully updated.")

if __name__ == "__main__":
    asyncio.run(main())