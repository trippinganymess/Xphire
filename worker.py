import os
import requests
import pandas as pd
from supabase import create_client, Client
from jobspy import scrape_jobs
from google import genai


url: str = os.environ.get("SUPABASE_URL")
key: str = os.environ.get("SUPABASE_KEY")
supabase: Client = create_client(url, key)

client = genai.Client()

def get_seen_jobs():

    response = supabase.table('Seen_job').select('job_id').execute()
    return {row['job_id'] for row in response.data}

def save_seen_jobs(job_ids):
    data = [{"job_id": jid} for jid in job_ids]
    if data:
        supabase.table('Seen_job').insert(data).execute()

def send_to_google_sheet(message_text):
    form_url = os.environ.get("GOOGLE_FORM_URL") 
    entry_id = os.environ.get("GOOGLE_ENTRY_ID")
    
    payload = {entry_id: message_text}
    
    try:
        response = requests.post(form_url, data=payload)
        if response.status_code == 200:
            print("Successfully logged batch to Google Sheets!")
        else:
            print(f"Failed to log to sheet. Status code: {response.status_code}")
    except Exception as e:
        print(f"Error connecting to Google Form: {e}")

def main():
    print("Initializing Scraper Pipeline...")
    jobs_df = scrape_jobs(
        site_name=["linkedin", "indeed", "glassdoor"],
        search_term="Software Engineer Intern",
        location="India",
        results_wanted=150
    )
    
    if jobs_df.empty:
        print("No jobs found by the scraper.")
        return

    seen_jobs = get_seen_jobs()
    new_jobs = jobs_df[~jobs_df['id'].isin(seen_jobs)]
    
    if new_jobs.empty:
        print("No net-new jobs detected. Exiting.")
        return

    print(f"Discovered {len(new_jobs)} new roles. Evaluating...")
    
    top_10 = new_jobs.head(10).to_dict('records')
    
    prompt = f"""
    You are a technical recruiter. Review these fresh job listings.
    Format them into a concise, scannable copy-pasteable summary block.
    Use minimalist formatting and emojis. Extract the Company, Title, and Job URL.
    Data: {top_10}
    """
    
    response = client.models.generate_content(
        model='gemini-3-flash',
        contents=prompt
    )
    
    send_to_google_sheet(response.text)
    save_seen_jobs(new_jobs['id'].tolist())
    print("Pipeline execution complete. Vault updated.")

if __name__ == "__main__":
    main()