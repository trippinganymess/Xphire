import os
import requests
import pandas as pd
from supabase import create_client, Client
from jobspy import scrape_jobs
from google.generativeai import configure, GenerativeModel

# 1. Initialize Clients
url: str = os.environ.get("SUPABASE_URL")
key: str = os.environ.get("SUPABASE_KEY")
supabase: Client = create_client(url, key)

configure(api_key=os.environ.get("GEMINI_API_KEY"))
llm = GenerativeModel('gemini-3-flash')

def get_seen_jobs():
    # Fetch the IDs we have already processed
    response = supabase.table('seen_jobs').select('job_id').execute()
    return {row['job_id'] for row in response.data}

def save_seen_jobs(job_ids):
    # Push new IDs to the database
    data = [{"job_id": jid} for jid in job_ids]
    if data:
        supabase.table('seen_jobs').insert(data).execute()

def send_whatsapp(message):
    url = f"https://graph.facebook.com/v17.0/{os.environ.get('WA_PHONE_ID')}/messages"
    headers = {
        "Authorization": f"Bearer {os.environ.get('WA_TOKEN')}", 
        "Content-Type": "application/json"
    }
    payload = {
        "messaging_product": "whatsapp",
        "to": os.environ.get('MY_PHONE_NUMBER'),
        "type": "text",
        "text": {"body": message}
    }
    requests.post(url, headers=headers, json=payload)

def main():
    print("Initializing Scraper Pipeline...")
    # Step 1: Scrape the raw feed
    jobs_df = scrape_jobs(
        site_name=["linkedin", "indeed", "glassdoor"],
        search_term="Software Engineer Intern",
        location="India",
        results_wanted=150
    )
    
    if jobs_df.empty:
        print("No jobs found by the scraper.")
        return

    # Step 2: Set Difference (B - A)
    seen_jobs = get_seen_jobs()
    new_jobs = jobs_df[~jobs_df['id'].isin(seen_jobs)]
    
    if new_jobs.empty:
        print("No net-new jobs detected. Exiting.")
        return

    print(f"Discovered {len(new_jobs)} new roles. Evaluating...")
    
    # Step 3: Extract the Top 10 for AI Formatting
    # (You can apply Pandas filters here for specific salaries or keywords)
    top_10 = new_jobs.head(10).to_dict('records')
    
    prompt = f"""
    You are a technical recruiter. Review these fresh job listings.
    Format them into a concise, scannable WhatsApp message.
    Use minimalist formatting and emojis. Extract the Company, Title, and Job URL.
    Data: {top_10}
    """
    
    formatted_message = llm.generate_content(prompt).text
    
    # Step 4: Dispatch & Sync State
    send_whatsapp(formatted_message)
    save_seen_jobs(new_jobs['id'].tolist())
    print("Pipeline execution complete. Vault updated.")

if __name__ == "__main__":
    main()