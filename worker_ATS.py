import os
import re
import asyncio
from typing import List, Dict, Any

from utils.deduper import Deduper
from utils.scraping import create_stealth_client

# ==========================================
# CONFIG & ENVIRONMENT VARIABLES
# ==========================================
GOOGLE_FORM_URL = os.environ.get("GOOGLE_FORM_URL_ATS") or os.environ.get("GOOGLE_FORM_URL")
GOOGLE_ENTRY_COMPANY = os.environ.get("GOOGLE_ENTRY_COMPANY")
GOOGLE_ENTRY_TITLE = os.environ.get("GOOGLE_ENTRY_TITLE")
GOOGLE_ENTRY_LINK = os.environ.get("GOOGLE_ENTRY_LINK")

if GOOGLE_FORM_URL and GOOGLE_FORM_URL.endswith("/viewform"):
    GOOGLE_FORM_URL = GOOGLE_FORM_URL.replace("/viewform", "/formResponse")

# ==========================================
# ATS TARGET SLUGS
# ==========================================
GREENHOUSE_SLUGS = [
    "razorpay", "phonepe", "groww", "swiggy", "zepto", "meesho", "postman",
    "curefit", "slice", "cred", "urbancompany", "nykaa", "blinkit", 
    "policybazaar", "zomato", "cars24", "inmobi", "commerceiq", "coindcx", 
    "hasura", "browserstack", "chargebee", "leadsquared", "darwinbox", 
    "classplus", "eruditus", "pinelabs", "delhivery", "innovaccer", "lenskart", 
    "spinny", "unacademy", "physicswallah", "shiprocket", "gupshup", "ofbusiness", 
    "games24x7", "dream11", "clevertap", "moengage", "webengage", "sprinklr", 
    "druva", "highradius", "icertis", "rategain", "amagi", "capillary", "quizizz",
    "fractal", "thoughtspot", "bharatpe", "upstox", "apna", "ola", "oyo", 
    "makemytrip", "flipkart", "paytm", "digit", "acko", "khatabook", "udaan",
    "myntra", "pharmeasy", "billdesk", "mindtickle", "locus", "dunzo",
    "airbnb", "stripe", "figma", "databricks", "coinbase", "okta", "cloudflare", 
    "lyft", "discord", "reddit", "upwork", "plaid", "instacart", "rippling", 
    "mongodb", "twilio", "github", "doordash", "robinhood", "square", "block", 
    "taboola", "pinterest", "box", "asana", "gitlab", "hashicorp", "datadog", 
    "snowflake", "confluent", "canva", "segment", "fivetran", "grab", "gojek", 
    "revolut", "monzo", "checkoutcom", "vimeo", "coursera", "udemy", "roblox", 
    "epicgames", "unity", "elastic", "dropbox", "gusto", "hubspot", "evernote", 
    "airtable", "atlassian", "adobe", "nutanix", "zscaler", "cisco", "vmware",
    "splunk", "crowdstrike", "paloaltonetworks", "fortinet", "sophos", "mulesoft",
]

LEVER_SLUGS = [
    "spotify", "palantir", "netflix", "mindtickle", "clear", "remote", 
    "loom", "zalando", "thoughtworks", "lever", "yelp", "eventbrite", 
    "zapier", "auth0", "contentful", "netlify", "framer", "webflow", 
    "shopify", "hopper", "fullstory", "invision", "lattice", 
    "gocardless", "trello", "sendgrid", "mailchimp", "pitch", "miro", 
    "mural", "sketch", "zeplin", "marvel", "balsamiq", "klook", "klarna", 
    "wix", "xero", "substack", "patreon", "peloton", "glossier", "tubi", 
    "duolingo", "masterclass", "outschool", "udacity", "1password",
    "algolia", "iterable", "g2", "kpmg",
]

ASHBY_SLUGS = [
    "notion", "ramp", "replit", "scale", "linear", "vercel", "perplexity", 
    "temporal", "modal", "openai", "cartesia", "parspec", "anthropic", 
    "cohere", "huggingface", "midjourney", "stability", "runway", "descript", 
    "jasper", "synthesia", "elevenlabs", "heygen", "tome", "gamma", "apollo", 
    "gong", "deel", "oyster", "gusto", "brex", "carta", "dbtlabs", "airbyte", 
    "prefect", "dagster", "posthog", "amplitude", "mixpanel", "farcaster", 
    "alchemy", "opensea", "polygon", "uniswap", "a16z", "sequoia", 
    "ycombinator", "beehiiv", "gumroad", "lottiefiles", "raycast", "superhuman",
    "warp", "flyio", "planetscale", "supabase", "clerk", "pinecone", "milvus",
]

SMARTRECRUITERS_SLUGS = [
    "square", "visa", "bosch", "ubisoft", "twitter", "linkedin", "ikea", 
    "equinox", "colliers", "biogen", "blueorigin", "smartrecruiters", "sgs",
    "averydennison", "mcdonalds", "loreal", "marcjacobs", "deloitte", "pwc", 
    "kaiserpermanente", "autodesk", "nielsen", "jll", "cbre", "mattel",
]

# ==========================================
# STRICT FILTERING PATTERNS
# ==========================================
INDIA_PATTERN = re.compile(
    r"\b(india|bengaluru|bangalore|mumbai|delhi|ncr|gurugram|gurgaon|noida|pune|hyderabad|chennai|remote)\b", 
    re.IGNORECASE,
)

LEVEL_PATTERN = re.compile(
    r"\b(intern|internship|fresher|entry[\s-]?level|grad|graduate|university|early[\s-]?career)\b", 
    re.IGNORECASE,
)

TECH_PATTERN = re.compile(
    r"\b(engineer|developer|backend|frontend|fullstack|data|devops|sre|ml|ai|software|qa|systems)\b", 
    re.IGNORECASE,
)

deduper = Deduper()


def is_valid_internship(title: str, location: str) -> bool:
    loc_str = str(location or "India")
    title_str = str(title or "")

    return bool(
        INDIA_PATTERN.search(loc_str)
        and LEVEL_PATTERN.search(title_str)
        and TECH_PATTERN.search(title_str)
    )


# ==========================================
# GOOGLE SHEET SUBMISSION
# ==========================================
async def submit_to_google_sheet(client, job: Dict[str, str]):
    if not all([GOOGLE_FORM_URL, GOOGLE_ENTRY_COMPANY, GOOGLE_ENTRY_TITLE, GOOGLE_ENTRY_LINK]):
        return

    payload = {
        GOOGLE_ENTRY_COMPANY: job["company"].upper(),
        GOOGLE_ENTRY_TITLE: job["title"],
        GOOGLE_ENTRY_LINK: job["url"],
    }

    try:
        response = await client.post(GOOGLE_FORM_URL, data=payload, timeout=10.0)
        if response.status_code in [200, 201]:
            print(f"  [SYNCED] -> {job['company']}: {job['title']}")
    except Exception:
        pass


# ==========================================
# ATS FETCHERS
# ==========================================
async def safe_get(client, url, semaphore):
    async with semaphore:
        try:
            return await client.get(url, timeout=15.0)
        except Exception:
            return None


async def fetch_greenhouse(client, slug, semaphore):
    url = f"https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=false"
    resp = await safe_get(client, url, semaphore)
    if not resp or resp.status_code != 200:
        return []

    jobs = []
    for j in resp.json().get("jobs", []):
        title = j.get("title", "")
        loc = j.get("location", {}).get("name", "")
        j_url = j.get("absolute_url", "")
        if is_valid_internship(title, loc):
            jobs.append({
                "job_id": deduper.generate_job_id(slug, title, j_url),
                "company": slug, "title": title, "url": j_url,
            })
    return jobs


async def fetch_lever(client, slug, semaphore):
    url = f"https://api.lever.co/v0/postings/{slug}?mode=json"
    resp = await safe_get(client, url, semaphore)
    if not resp or resp.status_code != 200:
        return []

    jobs = []
    for j in resp.json():
        title = j.get("text", "")
        loc = j.get("categories", {}).get("location", "")
        j_url = j.get("hostedUrl", "")
        if is_valid_internship(title, loc):
            jobs.append({
                "job_id": deduper.generate_job_id(slug, title, j_url),
                "company": slug, "title": title, "url": j_url,
            })
    return jobs


async def fetch_ashby(client, slug, semaphore):
    url = f"https://api.ashbyhq.com/gcs/v1/deb/organization/{slug}/job-board"
    resp = await safe_get(client, url, semaphore)
    if not resp or resp.status_code != 200:
        return []

    jobs = []
    for j in resp.json().get("jobs", []):
        title = j.get("title", "")
        loc = j.get("locationName", "")
        j_url = j.get("jobUrl", "")
        if is_valid_internship(title, loc):
            jobs.append({
                "job_id": deduper.generate_job_id(slug, title, j_url),
                "company": slug, "title": title, "url": j_url,
            })
    return jobs


async def fetch_smartrecruiters(client, slug, semaphore):
    url = f"https://api.smartrecruiters.com/v1/companies/{slug}/postings"
    resp = await safe_get(client, url, semaphore)
    if not resp or resp.status_code != 200:
        return []

    jobs = []
    for j in resp.json().get("content", []):
        title = j.get("name", "")
        loc = j.get("location", {}).get("city", "")
        j_url = f"https://jobs.smartrecruiters.com/{slug}/{j.get('id')}"
        if is_valid_internship(title, loc):
            jobs.append({
                "job_id": deduper.generate_job_id(slug, title, j_url),
                "company": slug, "title": title, "url": j_url,
            })
    return jobs


# ==========================================
# MAIN EXECUTION PIPELINE
# ==========================================
async def main():
    print("=" * 60)
    print("  ATS PIPELINE: GREENHOUSE | LEVER | ASHBY | SMARTRECRUITERS")
    print("=" * 60)

    semaphore = asyncio.Semaphore(15)

    async with create_stealth_client() as client:
        tasks = []
        for slug in GREENHOUSE_SLUGS:
            tasks.append(fetch_greenhouse(client, slug, semaphore))
        for slug in LEVER_SLUGS:
            tasks.append(fetch_lever(client, slug, semaphore))
        for slug in ASHBY_SLUGS:
            tasks.append(fetch_ashby(client, slug, semaphore))
        for slug in SMARTRECRUITERS_SLUGS:
            tasks.append(fetch_smartrecruiters(client, slug, semaphore))

        total_slugs = len(GREENHOUSE_SLUGS) + len(LEVER_SLUGS) + len(ASHBY_SLUGS) + len(SMARTRECRUITERS_SLUGS)
        print(f"Executing queries across {total_slugs} company ATS endpoints...")

        results = await asyncio.gather(*tasks)

        # 1. Flatten extracted jobs
        all_jobs = [job for sublist in results if sublist for job in sublist]

        # 2. Filter out already processed jobs using shared Deduper
        new_jobs = await deduper.get_unseen_jobs(client, all_jobs)

        if not new_jobs:
            print("\n[INFO] No new jobs to sync.")
            return

        print("-" * 60)
        print(f"Syncing {len(new_jobs)} new jobs to Google Sheet...")

        # 3. Upload new jobs to Google Sheet
        for job in new_jobs:
            await submit_to_google_sheet(client, job)

        # 4. Record new jobs in Supabase so they aren't synced again
        await deduper.save_seen_jobs(client, new_jobs)

    print("\n[COMPLETE] Pipeline run finished successfully.")


if __name__ == "__main__":
    asyncio.run(main())