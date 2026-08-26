"""
Shared scraping utilities for all Xphire workers.

Centralises: stealth HTTP client, Google Sheets posting, mass-recruiter
blocklist, proxy parsing, humanised pacing, and Google search term building.
"""

import os
import random
import asyncio
# pyrefly: ignore [missing-import]
import httpx
import pandas as pd
from typing import List, Optional

# ============================================================================
# USER-AGENT ROTATION POOL
# ============================================================================
# Real-world UA strings from recent Chrome / Firefox / Safari releases.
# One is picked at random per httpx client session so consecutive requests
# don't share an identical fingerprint.
_USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:128.0) Gecko/20100101 Firefox/128.0",
    "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0",
]


def get_random_user_agent() -> str:
    """Return a randomly-selected real-world User-Agent string."""
    return random.choice(_USER_AGENTS)


# ============================================================================
# STEALTH HTTP CLIENT FACTORY
# ============================================================================
def create_stealth_client(proxy: Optional[str] = None) -> httpx.AsyncClient:
    """
    Build an httpx.AsyncClient that mimics a real browser.

    - Rotated User-Agent per session
    - Realistic Accept / Accept-Language / DNT headers
    - Bounded connection pool to avoid hammering targets
    """
    headers = {
        "User-Agent": get_random_user_agent(),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,application/json,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "DNT": "1",
        "Connection": "keep-alive",
        "Upgrade-Insecure-Requests": "1",
    }

    pool_limits = httpx.Limits(
        max_connections=60,
        max_keepalive_connections=25,
    )

    return httpx.AsyncClient(
        headers=headers,
        limits=pool_limits,
        proxy=proxy,
        follow_redirects=True,
        timeout=httpx.Timeout(12.0, connect=8.0),
    )


# ============================================================================
# PROXY PARSING
# ============================================================================
def parse_proxy_list() -> Optional[List[str]]:
    """
    Read PROXY_URL env var.  Supports a single proxy or a comma-separated
    list for round-robin.  Returns None when unset.
    """
    proxy_url = os.environ.get("PROXY_URL")
    if not proxy_url:
        return None
    return [p.strip() for p in proxy_url.split(",") if p.strip()]


# ============================================================================
# GOOGLE SEARCH TERM BUILDER
# ============================================================================
# Google Jobs ignores search_term/location/hours_old entirely once you pass
# google_search_term.  It only understands natural-language text that looks
# like what Google's own Jobs search box would generate.
#
# To add a *verified* override for a title: search "{title} jobs" on
# google.com, open the Jobs panel, apply filters, and copy the text that
# appears in the panel's OWN search box (not the main Google search bar).
GOOGLE_QUERY_OVERRIDES: dict = {
    # "Software Engineer": "paste the verified string from Google Jobs here",
}


def build_google_search_term(title: str) -> str:
    """Build the natural-language query Google Jobs expects."""
    if title in GOOGLE_QUERY_OVERRIDES:
        return GOOGLE_QUERY_OVERRIDES[title]
    return f"{title} jobs near India since yesterday"


# ============================================================================
# MASS-RECRUITER BLOCKLIST
# ============================================================================
MASS_RECRUITERS = [
    "tcs", "tata consultancy services", "infosys", "wipro",
    "cognizant", "accenture", "capgemini", "tech mahindra",
    "hcl", "l&t", "larsen & toubro", "ibm",
]

_MASS_RECRUITER_PATTERN = "|".join(MASS_RECRUITERS)


def filter_mass_recruiters(df: pd.DataFrame) -> pd.DataFrame:
    """Remove rows whose 'company' column matches the blocklist."""
    before = len(df)
    df = df[~df["company"].str.contains(
        _MASS_RECRUITER_PATTERN, case=False, na=False, regex=True
    )]
    print(f"Mass-recruiter filter: {before} → {len(df)} jobs")
    return df


# ============================================================================
# HUMANISED PACING
# ============================================================================
# Per-site delay ranges (seconds).
SITE_DELAY_RANGES = {
    "linkedin": (5, 12),
    "indeed":   (5, 12),
    "google":   (5, 12),
}


async def human_delay(site: str, is_between_titles: bool = False):
    """
    Sleep for a randomised, human-plausible interval.

    - Between sites for the same title: uses SITE_DELAY_RANGES.
    - Between titles: longer 15-35 s pause.
    """
    if is_between_titles:
        pause = random.uniform(15, 35)
        print(f"Pausing {pause:.1f}s before next profile...")
        await asyncio.sleep(pause)
    else:
        low, high = SITE_DELAY_RANGES.get(site, (5, 12))
        delay = random.uniform(low, high)
        print(f"Waiting {delay:.1f}s before next request...")
        await asyncio.sleep(delay)


# ============================================================================
# GOOGLE FORMS DISPATCHER
# ============================================================================
async def send_batch_to_google_sheet(
    client: httpx.AsyncClient,
    jobs: list,
    default_role: str = "Software Role",
):
    """
    Dispatch a list of enriched job dicts to Google Sheets via a Google Form.

    Reads all 7 entry keys from environment variables and maps the full
    enriched payload. Concurrency is capped at 5.

    Args:
        client: Shared httpx.AsyncClient.
        jobs: List of enriched job dicts - must contain keys produced by
              df_to_job_dicts() + enrich_jobs():
              job_id, company, title, url, location, experience, salary,
              source, rating.
        default_role: Fallback title string when job['title'] is absent.
    """
    form_url = os.environ.get("GOOGLE_FORM_URL")
    entry_company = os.environ.get("GOOGLE_ENTRY_COMPANY")
    entry_title = os.environ.get("GOOGLE_ENTRY_TITLE")
    entry_link = os.environ.get("GOOGLE_ENTRY_LINK")
    entry_location = os.environ.get("GOOGLE_ENTRY_LOCATION")
    entry_experience = os.environ.get("GOOGLE_ENTRY_EXPERIENCE")
    entry_salary = os.environ.get("GOOGLE_ENTRY_SALARY")
    entry_source = os.environ.get("GOOGLE_ENTRY_SOURCE")

    if not all([form_url, entry_company, entry_title, entry_link]):
        print("[WARN] Core Google Form env vars missing - skipping sheet sync.")
        return

    print(f"\nPushing {len(jobs)} enriched entries to Google Sheets...")
    semaphore = asyncio.Semaphore(5)

    async def _post_job(job: dict):
        comp = str(job.get("company") or "Hidden Company").upper()
        role = str(job.get("title") or default_role)
        link = str(job.get("url") or "")
        location = str(job.get("location") or "India")
        experience = str(job.get("experience") or "Not Specified")
        salary = str(job.get("salary") or "Not Disclosed")
        rating = int(job.get("rating") or 3)
        source_raw = str(job.get("source") or "Unknown")
        source_str = f"{source_raw} (Rating: {'⭐' * rating})"

        payload: dict = {}
        if entry_company:    payload[entry_company]    = comp
        if entry_title:      payload[entry_title]      = role
        if entry_link:       payload[entry_link]       = link
        if entry_location:   payload[entry_location]   = location
        if entry_experience: payload[entry_experience] = experience
        if entry_salary:     payload[entry_salary]     = salary
        if entry_source:     payload[entry_source]     = source_str

        async with semaphore:
            try:
                resp = await client.post(form_url, data=payload, timeout=10.0)
                if resp.status_code not in (200, 201):
                    print(f"  [SHEET] Failed for {comp}. Status: {resp.status_code}")
                else:
                    print(f"  [SYNCED] {comp}: {role}")
            except Exception as exc:
                print(f"  [SHEET] Network error for {comp}: {exc}")

    await asyncio.gather(*[_post_job(job) for job in jobs])


# ============================================================================
# DATAFRAME -> DICT BRIDGE  (for Deduper + AI reviewer integration)
# ============================================================================
def df_to_job_dicts(df: pd.DataFrame, source_override: str = "") -> list[dict]:
    """
    Convert a JobSpy DataFrame into the List[Dict] schema used by the
    Deduper and AI reviewer.

    Common schema:
        job_id, company, title, url, location, description, source

    Args:
        df: Raw JobSpy DataFrame.
        source_override: If provided, overrides the 'site' column value.
    """
    records = []
    for _, row in df.iterrows():
        # Salary: build a human-readable string from min/max columns if present
        min_amt = row.get("min_amount")
        max_amt = row.get("max_amount")
        currency = str(row.get("currency") or "").upper()
        if pd.notna(min_amt) and pd.notna(max_amt):
            salary_str = f"{currency} {int(min_amt):,} - {int(max_amt):,} / yr"
        elif pd.notna(min_amt):
            salary_str = f"{currency} {int(min_amt):,}+"
        else:
            salary_str = "Not Disclosed"

        records.append({
            "job_id": str(row.get("id") or ""),
            "company": str(row.get("company") or ""),
            "title": str(row.get("title") or ""),
            "url": str(row.get("job_url") or ""),
            "location": str(row.get("location") or "India"),
            "description": str(row.get("description") or ""),
            "source": source_override or str(row.get("site") or "JobSpy"),
            "salary": salary_str,
        })
    return records


def filter_df_by_unseen(df: pd.DataFrame, unseen_ids: set) -> pd.DataFrame:
    """Keep only DataFrame rows whose 'id' is in the unseen set."""
    return df[df["id"].isin(unseen_ids)].copy()


# ============================================================================
# SHARED SCRAPING: CONSTANTS, COMPANY LISTS, FILTERS, ATS, JOBSPY
# ============================================================================

import re
from typing import Dict, Any, Optional as _Optional

# pyrefly: ignore [missing-import]
from jobspy import scrape_jobs as _jobspy_scrape_jobs

# ---------------------------------------------------------------------------
# Scraper config constants
# ---------------------------------------------------------------------------
COUNTRY_INDEED = "India"
CACHE_HOURS = 6
SCRAPERS = ["google", "linkedin", "indeed"]

# ---------------------------------------------------------------------------
# ATS TARGET SLUGS (850+ Tech Companies & Startups)
# ---------------------------------------------------------------------------
# Greenhouse (300+ tech companies, unicorns & product startups)
GREENHOUSE_SLUGS = list(dict.fromkeys([
    # Top Indian Startups & Tech Unicorns
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
    "tekion", "vymo", "infracloud", "jupiter", "khatabook", "loco",

    # Global Big Tech, Unicorns & Scaleups Hiring in India / Globally
    "airbnb", "stripe", "figma", "databricks", "coinbase", "okta", "cloudflare",
    "lyft", "discord", "reddit", "upwork", "plaid", "instacart", "rippling",
    "mongodb", "twilio", "github", "doordash", "robinhood", "square", "block",
    "taboola", "pinterest", "box", "asana", "gitlab", "hashicorp", "datadog",
    "snowflake", "confluent", "canva", "segment", "fivetran", "grab", "gojek",
    "revolut", "monzo", "checkoutcom", "vimeo", "coursera", "udemy", "roblox",
    "epicgames", "unity", "elastic", "dropbox", "gusto", "hubspot", "evernote",
    "airtable", "atlassian", "adobe", "nutanix", "zscaler", "cisco", "vmware",
    "splunk", "crowdstrike", "paloaltonetworks", "fortinet", "sophos", "mulesoft",
    "branch", "clari", "harness", "lucid", "mux", "pagerduty", "quora",
    "rubrik", "sentry", "sourcegraph", "sumologic", "toast", "verkada",
    "zoominfo", "zynga", "navan", "brex", "checkr", "benchling", "scaleapi",
    "anduril", "affirm", "chime", "sofi", "wealthfront", "gemini", "kraken",
    "ripple", "paxos", "chainalysis", "bolt", "samsara", "braze", "intercom",
    "heap", "launchdarkly", "mparticle", "optimizely", "dynatrace", "newrelic",
    "grafana", "honeycomb", "cribl", "chronosphere", "logicmonitor", "bigid",
    "snyk", "wiz", "orca", "lacework", "tanium", "sentinelone", "cybereason",

    # Infrastructure, DevTools, Cloud & Modern Platforms
    "canonical", "cockroachlabs", "dbtlabs", "grafanalabs", "kong",
    "liquibase", "mirantis", "neo4j", "ngrok", "percona", "pingidentity",
    "puppet", "rancher", "redhat", "scylladb", "sonarsource", "starburst",
    "timescale", "traefik", "trilogy", "yugabyte", "agora", "algorand",
    "alchemy", "alluxio", "anyscale", "appliedintuition", "aptos", "arbitrum",
    "automattic", "avast", "betterment", "blend", "blizzard", "brave",
    "broadcom", "buildkite", "bungie", "carta", "celestia", "chainlink",
    "circle", "circleci", "clever", "clickup", "cloudera", "coda",
    "codecademy", "coreweave", "couchbase", "cruise", "daily", "darktrace",
    "deepgram", "deliveroo", "deno", "digitalocean", "docker", "duo",
    "envoy", "epic", "etsy", "eventbrite", "expensify", "fauna", "fetch",
    "fiverr", "flexport", "fly", "freshworks", "front", "godaddy",
    "goodrx", "grammarly", "guidewire", "hackerone", "handshake", "headspace",
    "hightouch", "honey", "hopper", "hyperscience", "illumina", "imperva",
    "insitro", "instabase", "ironclad", "iterable", "jfrog", "juniper",
    "justworks", "kaltura", "kayak", "klarna", "kustomer", "leadiq",
    "lime", "linear", "looker", "mapbox", "marqeta", "mattermost",
    "medium", "meraki", "mercury", "metabase", "meter", "mindbody",
    "mixpanel", "moderna", "motive", "moveworks", "mozilla", "nerdwallet",
    "netapp", "netdata", "nextdoor", "niantic", "nordvpn", "nuro",
    "okx", "oneplus", "onfido", "opentable", "opendoor", "oracle",
    "outreach", "palantir", "pantheon", "pave", "paypal", "pendo",
    "personio", "pitchbook", "planet", "plivo", "pocket", "procore",
    "proton", "pubmatic", "purestorage", "qualtrics", "quantcast", "quizlet",
    "rapid7", "retool", "ringcentral", "riotgames", "roku", "rover",
    "sailpoint", "salesforce", "sap", "scribd", "seatgeek", "sendbird",
    "servicenow", "shogun", "signal", "sisense", "skydio", "slack",
    "smartling", "smartsheet", "snapchat", "snaplogic", "solana", "soundhound",
    "sprout", "squareup", "stackpath", "strava", "sunrun", "supercell",
    "superhuman", "suse", "synopsys", "tableau", "talend", "talkdesk",
    "target", "tealium", "teamviewer", "temporal", "teradata", "thumbtack",
    "tile", "tinder", "tripadvisor", "truework", "twosigma", "uber",
    "uipath", "unbounce", "unqork", "userzoom", "vanguard", "vanta",
    "veeam", "venmo", "veracode", "veritas", "viasat", "visa",
    "vox", "walmart", "warby", "wave", "waze", "whatnot",
    "wikimedia", "wish", "wix", "wolt", "workato", "workiva",
    "xero", "yext", "yotpo", "youtube", "zendesk", "zerodha",
    "zillow", "ziprecruiter", "zoho", "zoom",
]))

# Lever (250+ top tech companies, fintechs & fast-growing startups)
LEVER_SLUGS = list(dict.fromkeys([
    "spotify", "palantir", "netflix", "mindtickle", "clear", "remote",
    "loom", "zalando", "thoughtworks", "lever", "yelp", "eventbrite",
    "zapier", "auth0", "contentful", "netlify", "framer", "webflow",
    "shopify", "hopper", "fullstory", "invision", "lattice",
    "gocardless", "trello", "sendgrid", "mailchimp", "pitch", "miro",
    "mural", "sketch", "zeplin", "marvel", "balsamiq", "klook", "klarna",
    "wix", "xero", "substack", "patreon", "peloton", "glossier", "tubi",
    "duolingo", "masterclass", "outschool", "udacity", "1password",
    "algolia", "iterable", "g2", "kpmg", "deliveroo", "getir", "gorillas",
    "tier", "voi", "helbiz", "bird", "lime", "superhuman", "vanta",
    "ironclad", "zenefits", "papayaglobal", "oysterhr", "omnipresent",
    "shippo", "starlingbank", "oaknorth", "n26", "trade-republic",
    "bitpanda", "ledger", "bitstamp", "consensys", "rarible", "dapperlabs",
    "immutable", "animocabrands", "sky-mavis", "sorare", "axon", "formlabs",
    "whoop", "oura", "levels", "eight-sleep", "tempo", "tonal", "affinity",
    "agora", "airbrake", "aircall", "altana", "anchor", "angellist",
    "apify", "apollo", "appcues", "appsmith", "artlist", "ataccama",
    "atlas", "audius", "authentik", "avocode", "b12", "backstage",
    "bain", "bamboohr", "banza", "batch", "beeper", "belvo",
    "bentoml", "betterment", "bitly", "bitmex", "blackbird", "blockdaemon",
    "bluevoyant", "bold", "branch", "brandwatch", "bravado", "brave",
    "browserstack", "bugherd", "bullhorn", "bumble", "butter", "buzzsprout",
    "camunda", "candid", "capsule", "carbon", "careem", "carto",
    "casper", "celonis", "check", "chronicle", "clerk", "clever",
    "clockify", "codeclimate", "cohere", "coinmetro", "composio", "copper",
    "cord", "craft", "curve", "cyberhaven", "dbt", "delighted",
    "deputy", "dialpad", "drift", "dronedeploy", "duckduckgo", "eero",
    "elation", "enode", "envato", "esri", "expedia", "fabric",
    "fast", "fastly", "fathom", "favro", "feedly", "fellow",
    "fetch", "fidelity", "filecoin", "fireblocks", "fireship", "flock",
    "flutter", "formstack", "found", "frameio", "frontapp", "fuse",
    "gather", "geckoboard", "gem", "getstream", "ghost", "giantswarm",
    "gitbook", "glitch", "gooddata", "gradle", "greenhouse", "groove",
    "growthbook", "gruntwork", "hackerrank", "happyfox", "hasura", "hatch",
    "hearst", "helix", "helium", "hex", "hims", "honeybadger",
    "hootsuite", "hotjar", "hubstaff", "hyperswitch", "iconik", "idme",
    "incredibuild", "influxdata", "infura", "inmobi", "insight", "instapage",
    "intercom", "invisionapp", "ionic", "jotform", "jump", "justeat",
    "katana", "kayak", "keploy", "kickstarter", "kissflow", "knot",
    "konghq", "kontent", "kraken", "kustomer", "leadfeeder", "lemlist",
    "lightspeed", "linktree", "livekit", "livestorm", "logflare", "loop",
    "lucidchart", "lugg", "luno", "mailerlite", "mailgun", "mambu",
    "mapillary", "matrix", "matter", "maven", "maxmind", "maze",
    "medallia", "metabase", "mirakl", "monday", "mongodb", "mparticle",
    "msg91", "myfitnesspal", "nanit", "narrative", "native", "near",
    "netdata", "nextflow", "nexthink", "ngrok", "nitro", "novu",
    "obsidian", "octopus", "olark", "omnisend", "onefootball", "onesignal",
    "onflow", "onfleet", "online", "openreplay", "openstatus", "optimove",
    "optimizely", "orbit", "outreach", "overleaf", "paddle", "pager",
    "particle", "payfit", "paystack", "pencil", "pendo", "perimeter81",
    "phrase", "pinecone", "pingcap", "pipedrive", "plaid", "plane",
    "planetscale", "platzi", "podbean", "polymarket", "postman", "powerschool",
    "prisma", "privy", "productboard", "promethean", "pulse", "pusher",
    "qatalog", "qlik", "qonto", "qualaroo", "quantexa", "quickbase",
    "railway", "rainforest", "rapyd", "recurly", "redshift", "reflect",
    "reforge", "relay", "render", "replit", "responsive", "resy",
    "retool", "reverb", "revolut", "ribbon", "riskified", "roadie",
    "robinhood", "rockset", "rollbar", "ronin", "root", "route",
    "rudderstack", "runway", "safetywing", "salesloft", "samsara", "sanity",
    "sarvam", "scalable", "scale", "scaleway", "schibsted", "scrimba",
    "secoda", "secureframe", "segment", "semaphore", "sendinblue", "sensu",
    "sentry", "shadow", "shift", "shippo", "shiprocket", "shuttle",
    "signalwire", "signavio", "simpl", "simple", "singlestore", "sketch",
    "skillshare", "smarkets", "smartly", "smartrecruiters", "snack", "snyk",
    "socket", "solarwinds", "sonatype", "sonos", "sourcegraph", "spendesk",
    "split", "spot", "springer", "square", "stackblitz", "stackshare",
    "staffbase", "starling", "statsig", "status", "steelseries", "step",
    "stitch", "strapi", "stream", "stripe", "stytch", "supabase",
    "superblocks", "surge", "survicate", "svix", "swap", "synthesia",
    "tableau", "tactile", "tailwind", "takeaway", "tala", "talent",
    "tamara", "target", "taskrabbit", "taxfix", "tealium", "tecton",
    "telnyx", "tempo", "terraform", "thinkific", "thirdweb", "thoughtspot",
    "thumbtack", "tidb", "tier", "tines", "tiqets", "toast",
    "todoist", "toggl", "tomtom", "tophat", "toptal", "tourlane",
    "traefik", "trainline", "triage", "trivago", "truecaller", "tubi",
    "turso", "twingate", "typeform", "uber", "ubisoft", "udemy",
    "uizard", "unbounce", "unleash", "upguard", "upstack", "upstart",
    "upwork", "userflow", "userpilot", "uxcam", "validere", "vanta",
    "veeam", "venmo", "verbal", "vespa", "viber", "vidyard",
    "virtru", "visible", "visma", "vizio", "volt", "vouch",
    "vungle", "vymo", "vyond", "wave", "waze", "webflow",
    "weblate", "wheel", "willow", "wing", "wire", "wiremock",
    "wise", "wish", "wolt", "workhuman", "wpengine", "wrike",
    "xendit", "xoom", "yandex", "yoast", "yoco", "zapier",
    "zed", "zendesk", "zenml", "zerodha", "zilch", "zilliz",
    "zipline", "zomato", "zoopla", "zopa", "zuora",
]))

# Ashby (180+ modern AI startups, frontier labs & high-growth tech)
ASHBY_SLUGS = list(dict.fromkeys([
    "notion", "ramp", "replit", "scale", "linear", "vercel", "perplexity",
    "temporal", "modal", "openai", "cartesia", "parspec", "anthropic",
    "cohere", "huggingface", "midjourney", "stability", "runway", "descript",
    "jasper", "synthesia", "elevenlabs", "heygen", "tome", "gamma", "apollo",
    "gong", "deel", "oyster", "gusto", "brex", "carta", "dbtlabs", "airbyte",
    "prefect", "dagster", "posthog", "amplitude", "mixpanel", "farcaster",
    "alchemy", "opensea", "polygon", "uniswap", "a16z", "sequoia",
    "ycombinator", "beehiiv", "gumroad", "lottiefiles", "raycast", "superhuman",
    "warp", "flyio", "planetscale", "supabase", "clerk", "pinecone", "milvus",
    "cursor", "anysphere", "mistral", "together", "groq", "baseten", "fireworks",
    "deepinfra", "fal", "replicate", "resend", "mintlify", "dub", "cal",
    "langchain", "llamaindex", "chroma", "weaviate", "qdrant", "neon", "turso",
    "upstash", "inngest", "trigger", "highlight", "axiom", "openmeter", "polar",
    "speakeasy", "outerbounds", "coactive", "decagon", "sierra", "tavily",
    "e2b", "phidata", "mem0", "unstructured", "agentops", "cleanlab",
    "humanloop", "ragas", "truera", "helicone", "lunary", "portkey",
    "langfuse", "openpipe", "bifrost", "context", "crewai", "dust",
    "embed", "fixie", "flowise", "glean", "guardrails", "harvey",
    "helicone", "kapa", "lamini", "lexica", "llamaparse", "memgpt",
    "modular", "mosaicml", "nebius", "ollama", "omni", "palantir",
    "phind", "playht", "pydantic", "radon", "reka", "render",
    "relevance", "sakana", "sematic", "sentry", "shakudo", "superagi",
    "tavily", "telivy", "tensorlake", "togetherai", "unsloth", "vanna",
    "vector", "vllm", "voyage", "wandb", "weightsandbiases", "writer",
    "xai", "you", "zenml", "zerox", "zephyr",
]))

# SmartRecruiters (120+ global enterprise & tech employers)
SMARTRECRUITERS_SLUGS = list(dict.fromkeys([
    "square", "visa", "bosch", "ubisoft", "twitter", "linkedin", "ikea",
    "equinox", "colliers", "biogen", "blueorigin", "smartrecruiters", "sgs",
    "averydennison", "mcdonalds", "loreal", "marcjacobs", "deloitte", "pwc",
    "kaiserpermanente", "autodesk", "nielsen", "jll", "cbre", "mattel",
    "valeo", "alstom", "schneider-electric", "siemens", "abb", "honeywell",
    "hitachi", "cisco", "philips", "sony", "canon", "panasonic", "experian",
    "equifax", "transunion", "wolterskluwer", "relx", "reedelsevier",
    "thomsonreuters", "bloomberg", "factset", "morningstar", "spglobal",
    "moodys", "fitchratings", "blackrock", "vanguard", "statestreet",
    "fidelity", "charlesschwab", "ameritrade", "etrade", "interactivebrokers",
    "airbus", "amadeus", "atos", "axa", "barclays", "bnp-paribas",
    "capgemini", "cgi", "danone", "dassault-systemes", "deutsche-bank",
    "dhl", "ericsson", "esker", "ey", "generali", "hsbc",
    "ing", "kone", "kpmg", "legrand", "manpowergroup", "michelin",
    "natixis", "nokia", "orange", "publicis", "renault", "ricoh",
    "sanofi", "santander", "sap", "societe-generale", "sodexo", "steria",
    "stmicroelectronics", "telecom", "thales", "total", "valeo", "veolia",
    "vinci", "vodafone", "volkswagen", "volvo", "worldline", "zurich",
]))

# ---------------------------------------------------------------------------
# FILTERING PATTERNS
# ---------------------------------------------------------------------------
INDIA_PATTERN = re.compile(
    r"\b(india|bengaluru|bangalore|mumbai|delhi|ncr|gurugram|gurgaon|noida|pune|hyderabad|chennai|remote)\b",
    re.IGNORECASE,
)

TECH_PATTERN = re.compile(
    r"\b(engineer|developer|backend|frontend|fullstack|data|devops|sre|ml|ai|software|qa|systems|scientist|analyst)\b",
    re.IGNORECASE,
)

FRESHER_PATTERN = re.compile(
    r"\b(intern|internship|fresher|entry[\s-]?level|graduate|grad|0[\s-]?1[\s-]?yr|0[\s-]?2[\s-]?yr|junior|jr|trainee|associate|early[\s-]?career)\b",
    re.IGNORECASE,
)


def is_fresher_job(job: Dict[str, Any]) -> bool:
    """Check if a job dictionary matches fresher / entry-level / intern criteria."""
    title = str(job.get("title") or "")
    experience = str(job.get("experience") or "")
    description = str(job.get("description") or "")[:500]

    # 1. Match title
    if FRESHER_PATTERN.search(title):
        return True

    # 2. Match AI-extracted experience
    if FRESHER_PATTERN.search(experience) or "fresher" in experience.lower() or "0-1" in experience or "0-2" in experience:
        return True

    # 3. Match opening description lines
    if FRESHER_PATTERN.search(description):
        return True

    return False


def _is_relevant_ats_job(
    title: str,
    location: str,
    search_title: str,
    freshers_only: bool = False,
) -> bool:
    """Check if an ATS job is relevant to the search title, location, and fresher criteria."""
    loc_str = str(location or "India")
    title_str = str(title or "")
    search_lower = search_title.lower()

    # Location must match India or major Indian tech hubs or Remote
    if not INDIA_PATTERN.search(loc_str):
        return False

    # Title must be tech-related
    if not TECH_PATTERN.search(title_str):
        return False

    # If user asked for freshers only, title must match fresher criteria
    if freshers_only and not FRESHER_PATTERN.search(title_str):
        return False

    # Keyword overlap check between search title and role title
    search_keywords = {w for w in search_lower.split() if len(w) > 2}
    title_keywords = {w for w in title_str.lower().split() if len(w) > 2}
    if search_keywords and not (search_keywords & title_keywords):
        # Allow if search is generic like "Software Engineer" or "Intern"
        if not ("software" in search_lower or "engineer" in search_lower or "developer" in search_lower):
            return False

    return True


# ---------------------------------------------------------------------------
# ATS FETCHERS
# ---------------------------------------------------------------------------

async def _safe_get(client: httpx.AsyncClient, url: str, semaphore: asyncio.Semaphore):
    """GET with concurrency gate and error tolerance."""
    async with semaphore:
        try:
            return await client.get(url, timeout=12.0)
        except Exception:
            return None


async def _fetch_greenhouse(
    client: httpx.AsyncClient,
    slug: str,
    semaphore: asyncio.Semaphore,
    search_title: str,
    freshers_only: bool,
    deduper: "Deduper",
) -> List[Dict[str, Any]]:
    url = f"https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=false"
    resp = await _safe_get(client, url, semaphore)
    if not resp or resp.status_code != 200:
        return []

    jobs = []
    for j in resp.json().get("jobs", []):
        title = j.get("title", "")
        loc = j.get("location", {}).get("name", "")
        j_url = j.get("absolute_url", "")
        if _is_relevant_ats_job(title, loc, search_title, freshers_only):
            jobs.append({
                "job_id":  deduper.generate_job_id(slug, title, j_url),
                "company": slug,
                "title":   title,
                "url":     j_url,
                "location": loc or "India",
                "source":  "Greenhouse",
            })
    return jobs


async def _fetch_lever(
    client: httpx.AsyncClient,
    slug: str,
    semaphore: asyncio.Semaphore,
    search_title: str,
    freshers_only: bool,
    deduper: "Deduper",
) -> List[Dict[str, Any]]:
    url = f"https://api.lever.co/v0/postings/{slug}?mode=json"
    resp = await _safe_get(client, url, semaphore)
    if not resp or resp.status_code != 200:
        return []

    jobs = []
    for j in resp.json():
        title = j.get("text", "")
        loc = j.get("categories", {}).get("location", "")
        j_url = j.get("hostedUrl", "")
        if _is_relevant_ats_job(title, loc, search_title, freshers_only):
            jobs.append({
                "job_id":  deduper.generate_job_id(slug, title, j_url),
                "company": slug,
                "title":   title,
                "url":     j_url,
                "location": loc or "India",
                "source":  "Lever",
            })
    return jobs


async def _fetch_ashby(
    client: httpx.AsyncClient,
    slug: str,
    semaphore: asyncio.Semaphore,
    search_title: str,
    freshers_only: bool,
    deduper: "Deduper",
) -> List[Dict[str, Any]]:
    url = f"https://api.ashbyhq.com/gcs/v1/deb/organization/{slug}/job-board"
    resp = await _safe_get(client, url, semaphore)
    if not resp or resp.status_code != 200:
        return []

    jobs = []
    for j in resp.json().get("jobs", []):
        title = j.get("title", "")
        loc = j.get("locationName", "")
        j_url = j.get("jobUrl", "")
        if _is_relevant_ats_job(title, loc, search_title, freshers_only):
            jobs.append({
                "job_id":  deduper.generate_job_id(slug, title, j_url),
                "company": slug,
                "title":   title,
                "url":     j_url,
                "location": loc or "India",
                "source":  "Ashby",
            })
    return jobs


async def _fetch_smartrecruiters(
    client: httpx.AsyncClient,
    slug: str,
    semaphore: asyncio.Semaphore,
    search_title: str,
    freshers_only: bool,
    deduper: "Deduper",
) -> List[Dict[str, Any]]:
    url = f"https://api.smartrecruiters.com/v1/companies/{slug}/postings"
    resp = await _safe_get(client, url, semaphore)
    if not resp or resp.status_code != 200:
        return []

    jobs = []
    for j in resp.json().get("content", []):
        title = j.get("name", "")
        loc = j.get("location", {}).get("city", "")
        j_url = f"https://jobs.smartrecruiters.com/{slug}/{j.get('id')}"
        if _is_relevant_ats_job(title, loc, search_title, freshers_only):
            jobs.append({
                "job_id":  deduper.generate_job_id(slug, title, j_url),
                "company": slug,
                "title":   title,
                "url":     j_url,
                "location": loc or "India",
                "source":  "SmartRecruiters",
            })
    return jobs


# ---------------------------------------------------------------------------
# ATS PIPELINE
# ---------------------------------------------------------------------------

async def scrape_ats(
    client: httpx.AsyncClient,
    search_title: str,
    freshers_only: bool = False,
    deduper: _Optional["Deduper"] = None,
) -> List[Dict[str, Any]]:
    """Hit Greenhouse / Lever / Ashby / SmartRecruiters for relevant jobs."""
    if deduper is None:
        from utils.deduper import Deduper as _Deduper
        deduper = _Deduper()

    total_endpoints = (
        len(GREENHOUSE_SLUGS) + len(LEVER_SLUGS)
        + len(ASHBY_SLUGS) + len(SMARTRECRUITERS_SLUGS)
    )
    print(f"\n[ATS] Scanning {total_endpoints} ATS endpoints for '{search_title}' (Freshers: {freshers_only})...")
    semaphore = asyncio.Semaphore(40)

    tasks = []
    for slug in GREENHOUSE_SLUGS:
        tasks.append(_fetch_greenhouse(client, slug, semaphore, search_title, freshers_only, deduper))
    for slug in LEVER_SLUGS:
        tasks.append(_fetch_lever(client, slug, semaphore, search_title, freshers_only, deduper))
    for slug in ASHBY_SLUGS:
        tasks.append(_fetch_ashby(client, slug, semaphore, search_title, freshers_only, deduper))
    for slug in SMARTRECRUITERS_SLUGS:
        tasks.append(_fetch_smartrecruiters(client, slug, semaphore, search_title, freshers_only, deduper))

    results = await asyncio.gather(*tasks)
    all_ats = [job for sublist in results if sublist for job in sublist]
    print(f"[ATS] Discovered {len(all_ats)} matching jobs across ATS endpoints.")
    return all_ats


# ---------------------------------------------------------------------------
# JOBSPY SCRAPER
# ---------------------------------------------------------------------------

async def scrape_jobspy(
    title: str,
    proxy_list: list,
    freshers_only: bool = False,
) -> list:
    """Scrape via JobSpy (Google Jobs, LinkedIn, Indeed)."""
    search_query = f"{title} Fresher" if freshers_only and "fresher" not in title.lower() and "intern" not in title.lower() else title
    print(f"\n[SCRAPE] Starting JobSpy scrape for '{search_query}' across {SCRAPERS}...")
    site_order = SCRAPERS.copy()
    random.shuffle(site_order)
    frames = []

    for j, site in enumerate(site_order):
        print(f"  Scraping [{site}]...")
        try:
            df = await asyncio.to_thread(
                _jobspy_scrape_jobs,
                site_name=[site],
                search_term=search_query,
                google_search_term=build_google_search_term(search_query),
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
