"""
FreshLab Unified Email Pipeline.

Single worker that:
  1. Checks the Supabase cache for recent results
  2. If cache misses, scrapes via JobSpy (Google, LinkedIn, Indeed)
     AND via direct ATS APIs (Greenhouse, Lever, Ashby, SmartRecruiters)
  3. Deduplicates against Supabase
  4. Enriches via Gemini AI
  5. Sends a styled HTML email digest

Designed to run entirely on GitHub Actions (ubuntu-latest).
"""

import os
import re
import asyncio
import random
import pandas as pd
from jobspy import scrape_jobs
from typing import List, Dict, Any

from utils.ai_reviewer import enrich_jobs
from utils.deduper import Deduper
from utils.emailer import build_html_email, send_email
from utils.scraping import (
    build_google_search_term,
    create_stealth_client,
    df_to_job_dicts,
    filter_mass_recruiters,
    human_delay,
    parse_proxy_list,
)

# ============================================================================
# CONFIG
# ============================================================================
COUNTRY_INDEED  = "India"
CACHE_HOURS     = 6
MAX_EMAIL_JOBS  = 20
SCRAPERS        = ["google", "linkedin", "indeed"]

deduper = Deduper()

# ============================================================================
# ATS TARGET SLUGS  (carried over from worker_ats.py)
# ============================================================================
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

# ============================================================================
# ATS FILTERING  (for ATS-sourced jobs — title/location relevance check)
# ============================================================================
TITLE_PATTERN = re.compile(
    r"\b(engineer|developer|backend|frontend|fullstack|data|devops|sre|ml|ai|software|qa|systems|scientist|analyst)\b",
    re.IGNORECASE,
)


def _is_relevant_ats_job(title: str, location: str, search_title: str) -> bool:
    """Check if an ATS job is relevant to the search title and located in India."""
    loc_str = str(location or "India")
    title_str = str(title or "")
    search_lower = search_title.lower()

    # Location must mention India or a major Indian city or Remote
    india_pattern = re.compile(
        r"\b(india|bengaluru|bangalore|mumbai|delhi|ncr|gurugram|gurgaon|noida|pune|hyderabad|chennai|remote)\b",
        re.IGNORECASE,
    )
    if not india_pattern.search(loc_str):
        return False

    # Title must be tech-related
    if not TITLE_PATTERN.search(title_str):
        return False

    # Title should have some keyword overlap with the search title
    search_keywords = set(search_lower.split())
    title_keywords = set(title_str.lower().split())
    if search_keywords & title_keywords:
        return True

    # Fallback: at least it's a tech role in India
    return True


# ============================================================================
# ATS FETCHERS  (carried over from worker_ats.py)
# ============================================================================
async def _safe_get(client, url, semaphore):
    async with semaphore:
        try:
            return await client.get(url, timeout=15.0)
        except Exception:
            return None


async def _fetch_greenhouse(client, slug, semaphore, search_title) -> List[Dict[str, Any]]:
    url = f"https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=false"
    resp = await _safe_get(client, url, semaphore)
    if not resp or resp.status_code != 200:
        return []

    jobs = []
    for j in resp.json().get("jobs", []):
        title = j.get("title", "")
        loc = j.get("location", {}).get("name", "")
        j_url = j.get("absolute_url", "")
        if _is_relevant_ats_job(title, loc, search_title):
            jobs.append({
                "job_id":  deduper.generate_job_id(slug, title, j_url),
                "company": slug,
                "title":   title,
                "url":     j_url,
                "location": loc or "India",
                "source":  "Greenhouse",
            })
    return jobs


async def _fetch_lever(client, slug, semaphore, search_title) -> List[Dict[str, Any]]:
    url = f"https://api.lever.co/v0/postings/{slug}?mode=json"
    resp = await _safe_get(client, url, semaphore)
    if not resp or resp.status_code != 200:
        return []

    jobs = []
    for j in resp.json():
        title = j.get("text", "")
        loc = j.get("categories", {}).get("location", "")
        j_url = j.get("hostedUrl", "")
        if _is_relevant_ats_job(title, loc, search_title):
            jobs.append({
                "job_id":  deduper.generate_job_id(slug, title, j_url),
                "company": slug,
                "title":   title,
                "url":     j_url,
                "location": loc or "India",
                "source":  "Lever",
            })
    return jobs


async def _fetch_ashby(client, slug, semaphore, search_title) -> List[Dict[str, Any]]:
    url = f"https://api.ashbyhq.com/gcs/v1/deb/organization/{slug}/job-board"
    resp = await _safe_get(client, url, semaphore)
    if not resp or resp.status_code != 200:
        return []

    jobs = []
    for j in resp.json().get("jobs", []):
        title = j.get("title", "")
        loc = j.get("locationName", "")
        j_url = j.get("jobUrl", "")
        if _is_relevant_ats_job(title, loc, search_title):
            jobs.append({
                "job_id":  deduper.generate_job_id(slug, title, j_url),
                "company": slug,
                "title":   title,
                "url":     j_url,
                "location": loc or "India",
                "source":  "Ashby",
            })
    return jobs


async def _fetch_smartrecruiters(client, slug, semaphore, search_title) -> List[Dict[str, Any]]:
    url = f"https://api.smartrecruiters.com/v1/companies/{slug}/postings"
    resp = await _safe_get(client, url, semaphore)
    if not resp or resp.status_code != 200:
        return []

    jobs = []
    for j in resp.json().get("content", []):
        title = j.get("name", "")
        loc = j.get("location", {}).get("city", "")
        j_url = f"https://jobs.smartrecruiters.com/{slug}/{j.get('id')}"
        if _is_relevant_ats_job(title, loc, search_title):
            jobs.append({
                "job_id":  deduper.generate_job_id(slug, title, j_url),
                "company": slug,
                "title":   title,
                "url":     j_url,
                "location": loc or "India",
                "source":  "SmartRecruiters",
            })
    return jobs


# ============================================================================
# ATS PIPELINE  (query all ATS endpoints for a given search title)
# ============================================================================
async def scrape_ats(client, search_title: str) -> List[Dict[str, Any]]:
    """Hit Greenhouse / Lever / Ashby / SmartRecruiters for relevant jobs."""
    print(f"\n[ATS] Scanning ATS endpoints for '{search_title}'...")
    semaphore = asyncio.Semaphore(15)

    tasks = []
    for slug in GREENHOUSE_SLUGS:
        tasks.append(_fetch_greenhouse(client, slug, semaphore, search_title))
    for slug in LEVER_SLUGS:
        tasks.append(_fetch_lever(client, slug, semaphore, search_title))
    for slug in ASHBY_SLUGS:
        tasks.append(_fetch_ashby(client, slug, semaphore, search_title))
    for slug in SMARTRECRUITERS_SLUGS:
        tasks.append(_fetch_smartrecruiters(client, slug, semaphore, search_title))

    results = await asyncio.gather(*tasks)
    all_ats = [job for sublist in results if sublist for job in sublist]
    print(f"[ATS] Found {len(all_ats)} relevant jobs across ATS endpoints.")
    return all_ats


# ============================================================================
# CACHE LOOKUP
# ============================================================================
async def check_db_cache(client, title: str) -> list:
    if not deduper.supabase_url or not deduper.supabase_key:
        return []

    encoded = title.replace(" ", "%20")
    url = (
        f"{deduper.supabase_url.rstrip('/')}/rest/v1/Seen_job"
        f"?select=company,title,url,location,experience,salary,source,rating"
        f"&title=ilike.*{encoded}*"
        f"&scraped_at=gte.{_hours_ago_iso(CACHE_HOURS)}"
        f"&order=rating.desc"
        f"&limit=50"
    )
    try:
        resp = await client.get(url, headers=deduper.read_headers, timeout=10.0)
        if resp.status_code == 200:
            rows = resp.json()
            if rows:
                print(f"[CACHE] HIT — {len(rows)} cached jobs for '{title}' (< {CACHE_HOURS}h old)")
                return rows
    except Exception as exc:
        print(f"[CACHE] Query failed: {exc}")

    print(f"[CACHE] MISS — no fresh results for '{title}'. Running scrapers...")
    return []


def _hours_ago_iso(hours: int) -> str:
    from datetime import datetime, timezone, timedelta
    dt = datetime.now(timezone.utc) - timedelta(hours=hours)
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


# ============================================================================
# JOBSPY SCRAPER
# ============================================================================
async def scrape_jobspy(title: str, proxy_list: list) -> list:
    """Scrape via JobSpy (Google Jobs, LinkedIn, Indeed)."""
    print(f"\n[SCRAPE] Starting JobSpy scrape for '{title}' across {SCRAPERS}...")
    site_order = SCRAPERS.copy()
    random.shuffle(site_order)
    frames = []

    for j, site in enumerate(site_order):
        print(f"  Scraping [{site}]...")
        try:
            df = await asyncio.to_thread(
                scrape_jobs,
                site_name=[site],
                search_term=title,
                google_search_term=build_google_search_term(title),
                location="India",
                country_indeed=COUNTRY_INDEED,
                results_wanted=15,
                hours_old=CACHE_HOURS,
                proxies=proxy_list,
            )
            if df is not None and not df.empty:
                print(f"  -> {len(df)} results from {site}")
                frames.append(df)
            else:
                print(f"  -> No results from {site}")
        except Exception as exc:
            print(f"  -> Skipped {site}: {exc}")

        if j < len(site_order) - 1:
            await human_delay(site)

    if not frames:
        return []

    combined = pd.concat(frames, ignore_index=True).drop_duplicates(subset=["id"])
    combined = filter_mass_recruiters(combined)

    if combined.empty:
        return []

    return df_to_job_dicts(combined)


# ============================================================================
# MAIN PIPELINE
# ============================================================================
async def main():
    job_title       = os.environ.get("JOB_TITLE", "").strip()
    recipient_email = os.environ.get("RECIPIENT_EMAIL", "").strip()

    if not job_title:
        print("[ERROR] JOB_TITLE env var is required.")
        return
    if not recipient_email:
        print("[ERROR] RECIPIENT_EMAIL env var is required.")
        return

    print("=" * 60)
    print(f"  FreshLab Unified Pipeline")
    print(f"  Title   : {job_title}")
    print(f"  Recipient: {recipient_email}")
    print("=" * 60)

    proxy_list = parse_proxy_list()

    async with create_stealth_client() as client:
        # ── Step 1: Check cache ────────────────────────────────────────
        jobs = await check_db_cache(client, job_title)

        if not jobs:
            # ── Step 2a: Scrape via JobSpy ─────────────────────────────
            jobspy_results = await scrape_jobspy(job_title, proxy_list)

            # ── Step 2b: Scrape via ATS APIs ───────────────────────────
            ats_results = await scrape_ats(client, job_title)

            # ── Step 3: Combine all sources ────────────────────────────
            all_scraped = jobspy_results + ats_results

            if not all_scraped:
                print("[PIPELINE] No jobs found after scraping. Aborting.")
                return

            print(f"\n[PIPELINE] Combined {len(jobspy_results)} JobSpy + {len(ats_results)} ATS = {len(all_scraped)} total jobs")

            # ── Step 4: Dedup against Supabase ─────────────────────────
            new_jobs = await deduper.get_unseen_jobs(client, all_scraped)

            if new_jobs:
                new_jobs = await enrich_jobs(new_jobs)
                await deduper.save_seen_jobs(client, new_jobs)
                jobs = new_jobs
            else:
                print("[PIPELINE] All scraped jobs already in DB. Fetching best from cache...")
                jobs = await check_db_cache(client, job_title) or all_scraped[:MAX_EMAIL_JOBS]

    if not jobs:
        print("[PIPELINE] Nothing to email.")
        return

    # ── Step 5: Build and send email ───────────────────────────────────
    top_jobs = jobs[:MAX_EMAIL_JOBS]
    print(f"\n[EMAIL] Building digest for {len(top_jobs)} jobs...")

    html    = build_html_email(top_jobs, job_title)
    subject = f"🚀 {len(top_jobs)} {job_title} Roles · FreshLab AI"

    send_email(html, subject, recipient_email)
    print("\n[COMPLETE] Unified pipeline finished.")


if __name__ == "__main__":
    asyncio.run(main())
