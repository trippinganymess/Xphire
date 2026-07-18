import os
import asyncio
import aiohttp
import pandas as pd
from supabase import create_client, Client
from jobspy import scrape_jobs

# Supabase Initialization
SUPABASE_URL: str = os.environ.get("SUPABASE_URL")
SUPABASE_KEY: str = os.environ.get("SUPABASE_KEY")
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

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
    """
    Wraps the synchronous jobspy function in a thread to allow the event loop 
    to handle other scraping tasks concurrently.
    """
    print(f"Scraping [{site}] for profile: '{title}'...")
    try:
        # Run the blocking function in a background thread
        jobs_df = await asyncio.to_thread(
            scrape_jobs,
            site_name=[site],
            search_term=title,
            location="India",
            results_wanted=10,
            hours_old=6,
            proxies=proxy_list
        )
        if not jobs_df.empty:
            print(f"-> Success: Found {len(jobs_df)} roles on {site} for '{title}'")
            return jobs_df
    except Exception as e:
        print(f"-> Skipped {site} for '{title}' (Likely blocked or no results)")
    
    return pd.DataFrame()

async def send_batch_to_google_sheet_async(jobs_to_log: pd.DataFrame):
    """
    Uses aiohttp to push data to Google Forms concurrently.
    A semaphore is used to prevent rate-limiting by Google.
    """
    form_url = os.environ.get("GOOGLE_FORM_URL") 
    entry_company = os.environ.get("GOOGLE_ENTRY_COMPANY")
    entry_title = os.environ.get("GOOGLE_ENTRY_TITLE")
    entry_link = os.environ.get("GOOGLE_ENTRY_LINK")
    
    print(f"\nPushing {len(jobs_to_log)} curated entries to Google Sheets concurrently...")
    
    # Limit to 5 concurrent connections so Google Forms doesn't throw a 429 Too Many Requests
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
    print("Initializing High-Performance Async Scraper Pipeline...")
    
    search_titles = [
        "Software Engineer", 
        "Backend Engineer", 
        "Machine Learning Engineer", 
        "Data Scientist",
        "MLOps Engineer"
    ]
    
    scrapers = ["naukri", "google", "linkedin", "indeed", "glassdoor", "bayt"]

    # Crucial for 403s: Ensure your PROXY_URL is formatted as http://user:pass@host:port
    proxy_url = os.environ.get("PROXY_URL")
    proxy_list = [proxy_url] if proxy_url else None
    
    # 1. Fire off all scraping tasks concurrently
    scraping_tasks = []
    for site in scrapers:
        for title in search_titles:
            scraping_tasks.append(async_scrape_target(site, title, proxy_list))
    
    # Wait for all scrapers to finish
    results = await asyncio.gather(*scraping_tasks)
    
    # Filter out empty dataframes and combine
    all_scraped_jobs = [df for df in results if not df.empty]
            
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

    # 2. Database Deduplication
    scraped_ids = combined_df['id'].tolist()
    seen_jobs = get_seen_jobs(scraped_ids)
    new_jobs = combined_df[~combined_df['id'].isin(seen_jobs)]
    
    if new_jobs.empty:
        print("No net-new recent roles found since last execution window.")
        return

    print(f"Discovered {len(new_jobs)} total new roles.")
    top_70 = new_jobs.head(70)
    
    # 3. Asynchronously push to Google Sheets
    await send_batch_to_google_sheet_async(top_70)

    # 4. Save new jobs to Supabase
    save_seen_jobs(top_70['id'].tolist())
    print("\nPipeline execution complete. Vault successfully updated.")

if __name__ == "__main__":
    asyncio.run(main())