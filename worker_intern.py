import os
import asyncio
import aiohttp
import random
import pandas as pd
from supabase import create_client, Client
from jobspy import scrape_jobs

# Internship-focused sibling of worker.py. Same scraping / pacing / dedup /
# Google Sheet posting machinery - see that file for the full reasoning
# behind site selection, delay ranges, and the Google Jobs query quirks.
# The differences here are: intern-specific search titles, a job_type
# filter, a wider default lookback window, and a post-scrape title check
# as a safety net for that filter.

SUPABASE_URL: str = os.environ.get("SUPABASE_URL")
SUPABASE_KEY: str = os.environ.get("SUPABASE_KEY")
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

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

GOOGLE_QUERY_OVERRIDES = {
    # "Software Engineer Intern": "paste the verified string from Google Jobs here",
}

def build_google_search_term(title: str) -> str:
    if title in GOOGLE_QUERY_OVERRIDES:
        return GOOGLE_QUERY_OVERRIDES[title]
    # Same "since yesterday" phrasing confirmed to work in JobSpy's own
    # documented example, with an intern-flavored title swapped in. Same
    # caveat as worker.py: unverified beyond that one example - if a given
    # title keeps returning zero, test it manually on google.com and move
    # the confirmed string into the override dict above.
    return f"{title} jobs near India since yesterday"

SITE_DELAY_RANGES = {
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
            proxies=proxy_list
        )
        if jobs_df is not None and not jobs_df.empty:
            print(f"-> Success: Found {len(jobs_df)} roles on {site} for '{title}'")
            return jobs_df
        else:
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
        role = row['title'] if pd.notna(row['title']) else "Internship Role"
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

    # Supports a single proxy ("http://user:pass@host:port") or a
    # comma-separated list for JobSpy to round-robin through
    # ("proxy1,proxy2,proxy3"). Leave PROXY_URL unset to go direct.
    proxy_url = os.environ.get("PROXY_URL")
    proxy_list = [p.strip() for p in proxy_url.split(",")] if proxy_url else None

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
                low, high = SITE_DELAY_RANGES.get(site, (5, 12))
                delay = random.uniform(low, high)
                print(f"Waiting {delay:.1f}s before next request...")
                await asyncio.sleep(delay)

        if i < len(titles_order) - 1:
            pause = random.uniform(15, 35)
            print(f"Finished '{title}'. Pausing {pause:.1f}s before next profile...")
            await asyncio.sleep(pause)

    if not all_scraped_jobs:
        print("No active internship listings discovered across target criteria.")
        return

    combined_df = pd.concat(all_scraped_jobs, ignore_index=True)
    combined_df = combined_df.drop_duplicates(subset=['id'])

    # Safety-net filter: job_type="internship" above isn't guaranteed to be
    # honored by every site/scraper, so anything that slipped through
    # without "intern" in the title gets dropped here. Broaden the regex
    # (e.g. "intern|co-op|trainee") if you want to catch adjacent titles.
    print(f"Jobs before internship title filter: {len(combined_df)}")
    combined_df = combined_df[combined_df['title'].str.contains('intern', case=False, na=False)]
    print(f"Jobs remaining after internship title filter: {len(combined_df)}")

    if combined_df.empty:
        print("No listings survived the internship title filter.")
        return

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
        print("All scraped internships were caught by the recruiter filter.")
        return

    scraped_ids = combined_df['id'].tolist()
    seen_jobs = get_seen_jobs(scraped_ids)
    new_jobs = combined_df[~combined_df['id'].isin(seen_jobs)]

    if new_jobs.empty:
        print("No net-new internship postings found since last execution window.")
        return

    print(f"Discovered {len(new_jobs)} total new internships.")
    top_batch = new_jobs.head(MAX_JOBS_PER_RUN)

    await send_batch_to_google_sheet_async(top_batch)

    save_seen_jobs(top_batch['id'].tolist())
    print("\nInternship pipeline execution complete. Vault successfully updated.")

if __name__ == "__main__":
    asyncio.run(main())