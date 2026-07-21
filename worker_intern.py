import os
import re
import asyncio
import httpx
from typing import List, Dict, Any
from jobspy import scrape_jobs

# ==========================================
# ENVIRONMENT VARIABLES
# ==========================================
GOOGLE_FORM_URL = os.environ.get("GOOGLE_FORM_URL")
GOOGLE_ENTRY_COMPANY = os.environ.get("GOOGLE_ENTRY_COMPANY")
GOOGLE_ENTRY_TITLE = os.environ.get("GOOGLE_ENTRY_TITLE")
GOOGLE_ENTRY_LINK = os.environ.get("GOOGLE_ENTRY_LINK")
PROXY_URL = os.environ.get("PROXY_URL")

if GOOGLE_FORM_URL and GOOGLE_FORM_URL.endswith("/viewform"):
    GOOGLE_FORM_URL = GOOGLE_FORM_URL.replace("/viewform", "/formResponse")

# ATS Target Slugs
GREENHOUSE_SLUGS = [
    "airbnb", "stripe", "figma", "anthropic", "databricks", 
    "coinbase", "cloudflare", "lyft", "discord", "reddit", 
    "upwork", "plaid", "instacart", "razorpay", "phonepe"
]

# ==========================================
# FILTERING PATTERNS
# ==========================================
INDIA_PATTERN = re.compile(
    r"\b(india|bengaluru|bangalore|mumbai|delhi|ncr|gurugram|gurgaon|noida|pune|hyderabad|chennai)\b", 
    re.IGNORECASE
)

LEVEL_PATTERN = re.compile(
    r"\b(intern|internship|fresher|entry[\s-]?level|grad|graduate|university|early[\s-]?career)\b", 
    re.IGNORECASE
)

TECH_PATTERN = re.compile(
    r"\b(engineer|developer|backend|frontend|fullstack|data|devops|sre|ml|ai|software)\b", 
    re.IGNORECASE
)

def is_valid_internship(title: str, location: str) -> bool:
    """Validates that a posting is a technical, entry-level/intern role in India."""
    title_str = str(title or "")
    loc_str = str(location or "")
    
    return bool(
        INDIA_PATTERN.search(loc_str) and 
        LEVEL_PATTERN.search(title_str) and 
        TECH_PATTERN.search(title_str)
    )

# ==========================================
# GOOGLE FORM SUBMISSION
# ==========================================
async def submit_to_google_sheet(client: httpx.AsyncClient, job: Dict[str, str]):
    if not all([GOOGLE_FORM_URL, GOOGLE_ENTRY_COMPANY, GOOGLE_ENTRY_TITLE, GOOGLE_ENTRY_LINK]):
        print("[WARN] Google Form environment variables missing. Skipping upload.")
        return

    payload = {
        GOOGLE_ENTRY_COMPANY: job["company"].upper(),
        GOOGLE_ENTRY_TITLE: job["title"],
        GOOGLE_ENTRY_LINK: job["url"]
    }

    try:
        response = await client.post(GOOGLE_FORM_URL, data=payload, timeout=10.0)
        if response.status_code in [200, 201]:
            print(f"  [SYNCED] -> {job['company']}: {job['title']}")
        else:
            print(f"  [ERROR] Sheet upload failed ({response.status_code}) for {job['title']}")
    except Exception as e:
        print(f"  [ERROR] Form POST failed: {e}")

# ==========================================
# SOURCE 1: DIRECT GREENHOUSE ATS SCRAPER
# ==========================================
async def fetch_greenhouse_jobs(client: httpx.AsyncClient, slug: str) -> List[Dict[str, str]]:
    url = f"https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=false"
    try:
        response = await client.get(url, timeout=10.0)
        if response.status_code != 200:
            return []

        data = response.json()
        valid_jobs = []
        
        for job in data.get("jobs", []):
            title = job.get("title", "")
            location = job.get("location", {}).get("name", "India")
            
            if is_valid_internship(title, location):
                valid_jobs.append({
                    "company": slug,
                    "title": title,
                    "url": job.get("absolute_url"),
                    "source": "Greenhouse Direct"
                })
        return valid_jobs
    except Exception as e:
        print(f"[ERROR] Greenhouse failed for {slug}: {e}")
        return []

# ==========================================
# SOURCE 2: JOBSPY AGGREGATOR SCRAPER
# ==========================================
def run_jobspy_sync() -> List[Dict[str, str]]:
    """Runs JobSpy synchronously inside an async thread wrapper."""
    print("\n[JOBSPY] Executing aggregator search across LinkedIn/Indeed...")
    try:
        jobs_df = scrape_jobs(
            site_name=["linkedin", "indeed"],
            search_term="software engineer intern",
            location="India",
            results_wanted=20,
            hours_old=48,
            country_indeed="india",
            proxies=[PROXY_URL] if PROXY_URL else None
        )

        if jobs_df is None or jobs_df.empty:
            print("[JOBSPY] No jobs returned.")
            return []

        valid_jobs = []
        for _, row in jobs_df.iterrows():
            title = str(row.get("title", ""))
            location = str(row.get("location", ""))
            company = str(row.get("company", "Unknown"))
            job_url = str(row.get("job_url", ""))

            if is_valid_internship(title, location):
                valid_jobs.append({
                    "company": company,
                    "title": title,
                    "url": job_url,
                    "source": "JobSpy"
                })

        print(f"[JOBSPY] Found {len(valid_jobs)} valid internship postings.")
        return valid_jobs
    except Exception as e:
        print(f"[ERROR] JobSpy execution failed: {e}")
        return []

async def fetch_jobspy_jobs() -> List[Dict[str, str]]:
    """Wraps JobSpy synchronous call to run smoothly within asyncio."""
    return await asyncio.to_thread(run_jobspy_sync)

# ==========================================
# MAIN PIPELINE ORCHESTRATOR
# ==========================================
async def main():
    print("=" * 60)
    print("  JOB SCOUT AI - INTEGRATED PIPELINE (ATS + JOBSPY)")
    print("=" * 60)

    headers = {"User-Agent": "JobScoutAI/1.0"}
    async with httpx.AsyncClient(headers=headers) as client:
        # Build tasks for both ATS endpoints and JobSpy
        ats_tasks = [fetch_greenhouse_jobs(client, slug) for slug in GREENHOUSE_SLUGS]
        
        # Execute ATS scrapes and JobSpy concurrently
        print(f"[ATS] Querying {len(GREENHOUSE_SLUGS)} Greenhouse boards...")
        results = await asyncio.gather(*ats_tasks, fetch_jobspy_jobs())

        # Unpack results
        ats_results = results[:-1]
        jobspy_results = results[-1]

        flattened_ats = [job for company in ats_results for job in company]
        all_raw_jobs = flattened_ats + jobspy_results

        print("\n" + "-" * 60)
        print(f"Raw Matches: {len(flattened_ats)} from ATS | {len(jobspy_results)} from JobSpy")

        # Deduplicate by Job Title + Company Name before uploading
        seen_signatures = set()
        unique_jobs = []
        
        for job in all_raw_jobs:
            sig = f"{job['company'].lower()}:{job['title'].lower()}"
            if sig not in seen_signatures:
                seen_signatures.add(sig)
                unique_jobs.append(job)

        print(f"Deduplicated Total: {len(unique_jobs)} unique listings to sync.")
        print("-" * 60 + "\n")

        # Sync unique results to Google Sheets
        for job in unique_jobs:
            await submit_to_google_sheet(client, job)

    print("\n[COMPLETE] Pipeline run finished successfully.")

if __name__ == "__main__":
    asyncio.run(main())