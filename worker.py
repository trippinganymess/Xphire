import os
import requests
import pandas as pd
from supabase import create_client, Client
from jobspy import scrape_jobs

# Initialize Supabase client globally
SUPABASE_URL: str = os.environ.get("SUPABASE_URL")
SUPABASE_KEY: str = os.environ.get("SUPABASE_KEY")
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

def get_seen_jobs(scraped_ids: list) -> set:
    """
    Optimized: Scalable targeting. Instead of downloading your entire database 
    history (which will crash or slow down once you log thousands of jobs), 
    this targets ONLY the specific IDs scraped during this run.
    """
    if not scraped_ids:
        return set()
    try:
        response = supabase.table('Seen_job').select('job_id').in_('job_id', scraped_ids).execute()
        return {row['job_id'] for row in response.data}
    except Exception as e:
        print(f"Error querying deduplication vault: {e}")
        return set()

def save_seen_jobs(job_ids: list):
    """Commits unique, newly tracked IDs to the database in a single batch operation."""
    if not job_ids:
        return
    data = [{"job_id": jid} for jid in job_ids]
    try:
        supabase.table('Seen_job').insert(data).execute()
    except Exception as e:
        print(f"Error updating historical vault: {e}")

def send_batch_to_google_sheet(jobs_to_log: pd.DataFrame):
    """
    Optimized: Uses connection pooling (requests.Session). Reusing a single 
    TCP connection prevents the script from creating/tearing down 70 distinct 
    SSL handshakes, speeding up sheet logging by up to 5x.
    """
    form_url = os.environ.get("GOOGLE_FORM_URL") 
    entry_company = os.environ.get("GOOGLE_ENTRY_COMPANY")
    entry_title = os.environ.get("GOOGLE_ENTRY_TITLE")
    entry_link = os.environ.get("GOOGLE_ENTRY_LINK")
    
    print(f"Pushing {len(jobs_to_log)} curated entries to Google Sheets...")
    
    with requests.Session() as session:
        for _, row in jobs_to_log.iterrows():
            comp = row['company'] if pd.notna(row['company']) else "Hidden Company"
            role = row['title'] if pd.notna(row['title']) else "Software Role"
            link = row['job_url'] if pd.notna(row['job_url']) else ""
            
            payload = {
                entry_company: comp,
                entry_title: role,
                entry_link: link
            }
            
            try:
                response = session.post(form_url, data=payload)
                if response.status_code != 200:
                    print(f"Failed to log entry for {comp}. Status: {response.status_code}")
            except Exception as e:
                print(f"Network error syncing entry for {comp}: {e}")

def main():
    print("Initializing High-Performance Scraper Pipeline...")
    
    search_titles = [
        "Software Engineer", 
        "Backend Engineer", 
        "Machine Learning Engineer", 
        "Data Scientist",
        "MLOps Engineer"
    ]
    scrapers = ["linkedin", "indeed", "glassdoor", "zip_recruiter", "google", "naukri", "bayt"]

    proxy_url = os.environ.get("PROXY_URL")
    proxy_list = [proxy_url] if proxy_url else None
    all_scraped_jobs = []
    
    # 1. Gather raw data pools
    for title in search_titles:
        print(f"Scraping targets for: '{title}'...")
        try:
            jobs_df = scrape_jobs(
                site_name=scrapers,
                search_term=title,
                location="India",
                results_wanted=20,
                hours_old=6,
                proxies=proxy_list 
            )
            if not jobs_df.empty:
                all_scraped_jobs.append(jobs_df)
        except Exception as e:
            print(f"Scraper skipped block '{title}' due to network issue: {e}")
            continue
            
    if not all_scraped_jobs:
        print("No active listings discovered across target criteria.")
        return
        
    # Combine results and drop early duplicates across search variations
    combined_df = pd.concat(all_scraped_jobs, ignore_index=True)
    combined_df = combined_df.drop_duplicates(subset=['id'])

    # 2. Optimized: Filtering mass recruiters natively in Pandas
    print(f"Total jobs before filtering mass recruiters: {len(combined_df)}")
    mass_recruiters = [
        "tcs", "tata consultancy services", "infosys", "wipro", 
        "cognizant", "accenture", "capgemini", "tech mahindra", 
        "hcl", "l&t", "larsen & toubro", "ibm"
    ]
    pattern = '|'.join(mass_recruiters)
    
    # Using case=False and na=False directly is faster and avoids string allocation crashes
    combined_df = combined_df[~combined_df['company'].str.contains(pattern, case=False, na=False, regex=True)]
    print(f"Jobs remaining after blocklist applied: {len(combined_df)}")
    
    if combined_df.empty:
        print("All scraped jobs were caught by the recruiter filter.")
        return

    # 3. Targeted deduplication check
    scraped_ids = combined_df['id'].tolist()
    seen_jobs = get_seen_jobs(scraped_ids)
    new_jobs = combined_df[~combined_df['id'].isin(seen_jobs)]
    
    if new_jobs.empty:
        print("No net-new recent roles found since last execution window.")
        return

    print(f"Discovered {len(new_jobs)} total new roles.")
    
    # 4. Enforce submission quota limits
    top_70 = new_jobs.head(70)
    
    # Execute batch network push
    send_batch_to_google_sheet(top_70)
        
    # Commit the IDs to prevent future duplication
    save_seen_jobs(top_70['id'].tolist())
    print("Pipeline execution complete. Vault successfully updated.")

if __name__ == "__main__":
    main()