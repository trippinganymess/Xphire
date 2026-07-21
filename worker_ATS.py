import os
import re
import asyncio
import httpx
from typing import List, Dict, Any

# ==========================================
# CONFIG & ENVIRONMENT VARIABLES
# ==========================================
# New Google Form secrets for your dedicated ATS sheet
GOOGLE_FORM_URL = os.environ.get("GOOGLE_FORM_URL_ATS") or os.environ.get("GOOGLE_FORM_URL")
GOOGLE_ENTRY_COMPANY = os.environ.get("GOOGLE_ENTRY_COMPANY")
GOOGLE_ENTRY_TITLE = os.environ.get("GOOGLE_ENTRY_TITLE")
GOOGLE_ENTRY_LINK = os.environ.get("GOOGLE_ENTRY_LINK")

if GOOGLE_FORM_URL and GOOGLE_FORM_URL.endswith("/viewform"):
    GOOGLE_FORM_URL = GOOGLE_FORM_URL.replace("/viewform", "/formResponse")

# ==========================================
# COMPREHENSIVE ATS COMPANY LISTS
# ==========================================
GREENHOUSE_SLUGS = [
    # Top Indian Unicorns & Tech Outposts
    "razorpay", "phonepe", "groww", "swiggy", "zepto", "meesho", "postman",
    "curefit", "slice", "cred", "atlassian", "adobe",
    # Global Tech / Tier-1
    "airbnb", "stripe", "figma", "anthropic", "databricks", "coinbase",
    "cloudflare", "lyft", "discord", "reddit", "upwork", "plaid", 
    "instacart", "rippling", "elastic", "mongodb", "twilio", "github", 
    "doordash", "robinhood", "square", "block"
]

LEVER_SLUGS = [
    "spotify", "palantir", "netflix", "mindtickle", "clear", 
    "remote", "loom", "zalando", "thoughtworks", "elastic"
]

ASHBY_SLUGS = [
    "notion", "ramp", "replit", "scale", "linear", 
    "vercel", "perplexity", "temporal", "modal", "openai"
]

SMARTRECRUITERS_SLUGS = [
    "square", "visa", "bosch", "ubisoft"
]

# ==========================================
# STRICT FILTERING PATTERNS
# ==========================================
INDIA_PATTERN = re.compile(
    r"\b(india|bengaluru|bangalore|mumbai|delhi|ncr|gurugram|gurgaon|noida|pune|hyderabad|chennai|remote)\b", 
    re.IGNORECASE
)

LEVEL_PATTERN = re.compile(
    r"\b(intern|internship|fresher|entry[\s-]?level|grad|graduate|university|early[\s-]?career)\b", 
    re.IGNORECASE
)

TECH_PATTERN = re.compile(
    r"\b(engineer|developer|backend|frontend|fullstack|data|devops|sre|ml|ai|software|qa|systems)\b", 
    re.IGNORECASE
)

def is_valid_internship(title: str, location: str) -> bool:
    """Filters specifically for Indian, technical, entry/intern positions."""
    loc_str = str(location or "India")
    title_str = str(title or "")

    return bool(
        INDIA_PATTERN.search(loc_str) and 
        LEVEL_PATTERN.search(title_str) and 
        TECH_PATTERN.search(title_str)
    )

# ==========================================
# GOOGLE SHEET / FORM WEBHOOK SUBMISSION
# ==========================================
async def submit_to_google_sheet(client: httpx.AsyncClient, job: Dict[str, str]):
    if not all([GOOGLE_FORM_URL, GOOGLE_ENTRY_COMPANY, GOOGLE_ENTRY_TITLE, GOOGLE_ENTRY_LINK]):
        print("[WARN] Google Form ATS env vars missing. Skipping sheet upload.")
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
            print(f"  [ERROR] Upload failed ({response.status_code}) for {job['title']}")
    except Exception as e:
        print(f"  [ERROR] Google Form POST failed: {e}")

# ==========================================
# ATS FETCHERS (GREENHOUSE, LEVER, ASHBY, SMARTRECRUITERS)
# ==========================================
async def fetch_greenhouse(client: httpx.AsyncClient, slug: str) -> List[Dict[str, str]]:
    url = f"https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=false"
    try:
        resp = await client.get(url, timeout=10.0)
        if resp.status_code != 200:
            return []
        jobs = resp.json().get("jobs", [])
        return [{
            "company": slug,
            "title": j.get("title", ""),
            "url": j.get("absolute_url"),
            "source": "Greenhouse"
        } for j in jobs if is_valid_internship(j.get("title", ""), j.get("location", {}).get("name", ""))]
    except Exception:
        return []

async def fetch_lever(client: httpx.AsyncClient, slug: str) -> List[Dict[str, str]]:
    url = f"https://api.lever.co/v0/postings/{slug}?mode=json"
    try:
        resp = await client.get(url, timeout=10.0)
        if resp.status_code != 200:
            return []
        jobs = resp.json()
        return [{
            "company": slug,
            "title": j.get("text", ""),
            "url": j.get("hostedUrl"),
            "source": "Lever"
        } for j in jobs if is_valid_internship(j.get("text", ""), j.get("categories", {}).get("location", ""))]
    except Exception:
        return []

async def fetch_ashby(client: httpx.AsyncClient, slug: str) -> List[Dict[str, str]]:
    url = f"https://api.ashbyhq.com/gcs/v1/deb/organization/{slug}/job-board"
    try:
        resp = await client.get(url, timeout=10.0)
        if resp.status_code != 200:
            return []
        jobs = resp.json().get("jobs", [])
        return [{
            "company": slug,
            "title": j.get("title", ""),
            "url": j.get("jobUrl"),
            "source": "Ashby"
        } for j in jobs if is_valid_internship(j.get("title", ""), j.get("locationName", ""))]
    except Exception:
        return []

async def fetch_smartrecruiters(client: httpx.AsyncClient, slug: str) -> List[Dict[str, str]]:
    url = f"https://api.smartrecruiters.com/v1/companies/{slug}/postings"
    try:
        resp = await client.get(url, timeout=10.0)
        if resp.status_code != 200:
            return []
        jobs = resp.json().get("content", [])
        return [{
            "company": slug,
            "title": j.get("name", ""),
            "url": f"https://jobs.smartrecruiters.com/{slug}/{j.get('id')}",
            "source": "SmartRecruiters"
        } for j in jobs if is_valid_internship(j.get("name", ""), j.get("location", {}).get("city", ""))]
    except Exception:
        return []

# ==========================================
# MAIN EXECUTION PIPELINE
# ==========================================
async def main():
    print("=" * 60)
    print("  ATS DIRECT PIPELINE: GREENHOUSE | LEVER | ASHBY | SMARTRECRUITERS")
    print("=" * 60)

    headers = {"User-Agent": "JobScoutAI/2.0"}
    
    async with httpx.AsyncClient(headers=headers) as client:
        # Build tasks
        tasks = []
        for slug in GREENHOUSE_SLUGS:
            tasks.append(fetch_greenhouse(client, slug))
        for slug in LEVER_SLUGS:
            tasks.append(fetch_lever(client, slug))
        for slug in ASHBY_SLUGS:
            tasks.append(fetch_ashby(client, slug))
        for slug in SMARTRECRUITERS_SLUGS:
            tasks.append(fetch_smartrecruiters(client, slug))

        print(f"Executing direct queries across {len(tasks)} company ATS endpoints...")
        results = await asyncio.gather(*tasks)

        # Flatten & Deduplicate results
        all_jobs = [job for sublist in results for job in sublist]
        
        seen = set()
        unique_jobs = []
        for job in all_jobs:
            sig = f"{job['company'].lower()}:{job['title'].lower()}"
            if sig not in seen:
                seen.add(sig)
                unique_jobs.append(job)

        print(f"Found {len(unique_jobs)} unique Indian internships across ATS endpoints.")
        print("-" * 60)

        # Upload results
        for job in unique_jobs:
            await submit_to_google_sheet(client, job)

    print("\n[COMPLETE] ATS Direct pipeline run finished.")
if __name__ == "__main__":
    asyncio.run(main())