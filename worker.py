import os
import requests
import pandas as pd
from supabase import create_client, Client
from jobspy import scrape_jobs

# Initialize Supabase
url: str = os.environ.get("SUPABASE_URL")
key: str = os.environ.get("SUPABASE_KEY")
supabase: Client = create_client(url, key)

def get_seen_jobs():
    try:
        response = supabase.table('Seen_job').select('job_id').execute()
        return {row['job_id'] for row in response.data}
    except Exception as e:
        print(f"Error fetching historical vault: {e}")
        return set()

def save_seen_jobs(job_ids):
    data = [{"job_id": jid} for jid in job_ids]
    if data:
        try:
            supabase.table('Seen_job').insert(data).execute()
        except Exception as e:
            print(f"Error updating vault: {e}")

def send_to_google_sheet(company, title, job_url):
    form_url = os.environ.get("GOOGLE_FORM_URL") 
    
    entry_company = os.environ.get("GOOGLE_ENTRY_COMPANY")
    entry_title = os.environ.get("GOOGLE_ENTRY_TITLE")
    entry_link = os.environ.get("GOOGLE_ENTRY_LINK")
    
    payload = {
        entry_company: company,
        entry_title: title,
        entry_link: job_url
    }
    
    try:
  
        response = requests.post(form_url, data=payload)
        if response.status_code != 200:
            print(f"Failed to log entry for {company}. Status: {response.status_code}")
    except Exception as e:
        print(f"Network error linking to Sheet: {e}")

def main():
    print("Initializing Advanced Scraper Pipeline...")

    search_titles = [
        "Software Engineer", 
        "Backend Engineer", 
        "Machine Learning Engineer", 
        "Data Scientist"
    ]

    scrapers = ["linkedin", "indeed", "glassdoor", "zip_recruiter", "google", "naukri", "bayt"]
    
    all_scraped_jobs = []
    
    for title in search_titles:
        print(f"Scraping active listings for: '{title}'...")
        try:
            jobs_df = scrape_jobs(
                site_name=scrapers,
                search_term=title,
                location="India",
                results_wanted=50,  
                hours_old=6       
            )
            if not jobs_df.empty:
                all_scraped_jobs.append(jobs_df)
        except Exception as e:
            print(f"Scraper encountered an issue on title '{title}': {e}")
            continue
            
    if not all_scraped_jobs:
        print("No roles pulled across any domain target.")
        return
    
    combined_df = pd.concat(all_scraped_jobs, ignore_index=True)

    combined_df = combined_df.drop_duplicates(subset=['id'])

    seen_jobs = get_seen_jobs()
    new_jobs = combined_df[~combined_df['id'].isin(seen_jobs)]
    
    if new_jobs.empty:
        print("No net-new recent roles found since last execution window.")
        return

    print(f"Discovered {len(new_jobs)} total new roles.")

    top_70 = new_jobs.head(70)
    print(f"Pushing top {len(top_70)} curated entries into active processing columns...")
    
    for index, row in top_70.iterrows():

        comp = row['company'] if pd.notna(row['company']) else "Hidden Company"
        role = row['title'] if pd.notna(row['title']) else "Software Role"
        link = row['job_url'] if pd.notna(row['job_url']) else ""
        
        send_to_google_sheet(comp, role, link)
        
    save_seen_jobs(top_70['id'].tolist())
    print("Pipeline execution complete. Vault successfully updated.")

if __name__ == "__main__":
    main()