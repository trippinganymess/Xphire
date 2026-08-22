"""
Xphire Unified Email Pipeline.

Single worker that:
  1. Parses search inputs (job_title, recipient_email, freshers_only, min_stars)
  2. Checks the Supabase cache for recent matching results (< 6h old, min_stars, freshers_only)
  3. If cache misses, scrapes via JobSpy (Google Jobs, LinkedIn, Indeed)
     AND via direct ATS APIs (Greenhouse, Lever, Ashby, SmartRecruiters)
  4. Deduplicates against Supabase
  5. Enriches via Gemini AI (rating 1-5, location, experience, salary)
  6. Filters by minimum star rating & fresher status
  7. Sends a styled HTML email digest

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
# EXPANDED ATS TARGET SLUGS (850+ Tech Companies & Startups)
# ============================================================================
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

# ============================================================================
# FILTERING PATTERNS
# ============================================================================
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


# ============================================================================
# ATS FETCHERS
# ============================================================================
async def _safe_get(client, url, semaphore):
    async with semaphore:
        try:
            return await client.get(url, timeout=12.0)
        except Exception:
            return None


async def _fetch_greenhouse(client, slug, semaphore, search_title, freshers_only) -> List[Dict[str, Any]]:
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


async def _fetch_lever(client, slug, semaphore, search_title, freshers_only) -> List[Dict[str, Any]]:
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


async def _fetch_ashby(client, slug, semaphore, search_title, freshers_only) -> List[Dict[str, Any]]:
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


async def _fetch_smartrecruiters(client, slug, semaphore, search_title, freshers_only) -> List[Dict[str, Any]]:
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


# ============================================================================
# ATS PIPELINE
# ============================================================================
async def scrape_ats(client, search_title: str, freshers_only: bool = False) -> List[Dict[str, Any]]:
    """Hit Greenhouse / Lever / Ashby / SmartRecruiters for relevant jobs."""
    total_endpoints = (
        len(GREENHOUSE_SLUGS) + len(LEVER_SLUGS)
        + len(ASHBY_SLUGS) + len(SMARTRECRUITERS_SLUGS)
    )
    print(f"\n[ATS] Scanning {total_endpoints} ATS endpoints for '{search_title}' (Freshers: {freshers_only})...")
    semaphore = asyncio.Semaphore(40)

    tasks = []
    for slug in GREENHOUSE_SLUGS:
        tasks.append(_fetch_greenhouse(client, slug, semaphore, search_title, freshers_only))
    for slug in LEVER_SLUGS:
        tasks.append(_fetch_lever(client, slug, semaphore, search_title, freshers_only))
    for slug in ASHBY_SLUGS:
        tasks.append(_fetch_ashby(client, slug, semaphore, search_title, freshers_only))
    for slug in SMARTRECRUITERS_SLUGS:
        tasks.append(_fetch_smartrecruiters(client, slug, semaphore, search_title, freshers_only))

    results = await asyncio.gather(*tasks)
    all_ats = [job for sublist in results if sublist for job in sublist]
    print(f"[ATS] Discovered {len(all_ats)} matching jobs across ATS endpoints.")
    return all_ats


# ============================================================================
# CACHE LOOKUP
# ============================================================================
async def check_db_cache(
    client,
    title: str,
    freshers_only: bool = False,
    min_stars: int = 1,
    limit: int = 60,
) -> list:
    if not deduper.supabase_url or not deduper.supabase_key:
        return []

    encoded = title.replace(" ", "%20")
    rating_filter = f"&rating=gte.{min_stars}" if min_stars > 1 else ""
    url = (
        f"{deduper.supabase_url.rstrip('/')}/rest/v1/Seen_job"
        f"?select=company,title,url,location,experience,salary,source,rating"
        f"&title=ilike.*{encoded}*"
        f"{rating_filter}"
        f"&scraped_at=gte.{_hours_ago_iso(CACHE_HOURS)}"
        f"&order=rating.desc"
        f"&limit={limit}"
    )
    try:
        resp = await client.get(url, headers=deduper.read_headers, timeout=10.0)
        if resp.status_code == 200:
            rows = resp.json()
            if freshers_only and rows:
                rows = [r for r in rows if is_fresher_job(r)]
            if rows:
                print(f"[CACHE] {len(rows)} cached jobs found for '{title}' (≥{min_stars}★, < {CACHE_HOURS}h old)")
                return rows
    except Exception as exc:
        print(f"[CACHE] Query failed: {exc}")

    print(f"[CACHE] No cached results for '{title}'.")
    return []


def _hours_ago_iso(hours: int) -> str:
    from datetime import datetime, timezone, timedelta
    dt = datetime.now(timezone.utc) - timedelta(hours=hours)
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


# ============================================================================
# JOBSPY SCRAPER
# ============================================================================
async def scrape_jobspy(title: str, proxy_list: list, freshers_only: bool = False) -> list:
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
                scrape_jobs,
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


# ============================================================================
# MAIN PIPELINE
# ============================================================================
async def main():
    job_title         = os.environ.get("JOB_TITLE", "").strip()
    recipient_email   = os.environ.get("RECIPIENT_EMAIL", "").strip()
    freshers_only_raw = os.environ.get("FRESHERS_ONLY", "false").strip().lower()
    freshers_only     = freshers_only_raw in ("true", "1", "yes")

    try:
        min_stars = int(os.environ.get("MIN_STARS", "3").strip() or "3")
        min_stars = max(1, min(5, min_stars))
    except ValueError:
        min_stars = 3

    if not job_title:
        print("[ERROR] JOB_TITLE env var is required.")
        return
    if not recipient_email:
        print("[ERROR] RECIPIENT_EMAIL env var is required.")
        return

    print("=" * 60)
    print(f"  Xphire Unified Pipeline")
    print(f"  Title        : {job_title}")
    print(f"  Recipient    : {recipient_email}")
    print(f"  Freshers Only: {freshers_only}")
    print(f"  Min Stars    : {min_stars}★")
    print("=" * 60)

    proxy_list = parse_proxy_list()

    # MAX backfill candidates to pull from cache (3× the email quota)
    MAX_CACHE_BACKFILL = MAX_EMAIL_JOBS * 3

    async with create_stealth_client() as client:
        # -- Step 1 & 2: Parallel — cache lookup + live scrapers ----------
        print("\n[PIPELINE] Running cache lookup and live scrapers in parallel...")
        cache_task = check_db_cache(
            client,
            job_title,
            freshers_only=freshers_only,
            min_stars=min_stars,
            limit=MAX_CACHE_BACKFILL,
        )
        scrape_task = asyncio.gather(
            scrape_jobspy(job_title, proxy_list, freshers_only=freshers_only),
            scrape_ats(client, job_title, freshers_only=freshers_only),
        )
        cache_jobs, (jobspy_results, ats_results) = await asyncio.gather(cache_task, scrape_task)

        # -- Step 3: Dedup new scraped jobs against DB, enrich & save -----
        all_scraped = jobspy_results + ats_results
        new_jobs: List[Dict[str, Any]] = []

        if all_scraped:
            print(f"\n[PIPELINE] Combined {len(jobspy_results)} JobSpy + {len(ats_results)} ATS = {len(all_scraped)} total scraped")
            unseen = await deduper.get_unseen_jobs(client, all_scraped)
            if unseen:
                # -- Step 4: AI Reviewer & Enrichment ---------------------
                unseen = await enrich_jobs(unseen)
                await deduper.save_seen_jobs(client, unseen)
                new_jobs = unseen
            else:
                print("[PIPELINE] All scraped jobs already in DB. Using cache backfill only.")
        else:
            print("[PIPELINE] No jobs returned from live scrapers. Using cache backfill only.")

        # -- Step 5: Hybrid merge — fresh scraped first, cache fills rest --
        seen_urls = {j.get("url", "") for j in new_jobs if j.get("url")}
        cache_backfill = [j for j in cache_jobs if j.get("url", "") not in seen_urls]

        # Sort each pool by rating descending
        new_jobs_sorted    = sorted(new_jobs,       key=lambda j: int(j.get("rating", 3) or 3), reverse=True)
        cache_backfill_sorted = sorted(cache_backfill, key=lambda j: int(j.get("rating", 3) or 3), reverse=True)

        jobs = new_jobs_sorted + cache_backfill_sorted
        print(
            f"\n[PIPELINE] Hybrid pool: {len(new_jobs_sorted)} fresh + "
            f"{len(cache_backfill_sorted)} cache backfill = {len(jobs)} total"
        )

        # -- Step 6: Post-enrichment filtering (Freshers & Min Stars) -----
        if freshers_only:
            before = len(jobs)
            jobs = [j for j in jobs if is_fresher_job(j)]
            print(f"[FILTER] Freshers filter: {before} -> {len(jobs)} jobs")

        if min_stars > 1:
            before = len(jobs)
            jobs = [j for j in jobs if int(j.get("rating", 3) or 3) >= min_stars]
            print(f"[FILTER] Rating >= {min_stars}★ filter: {before} -> {len(jobs)} jobs")

    if not jobs:
        print("[PIPELINE] No jobs found from any source. Nothing to email.")
        return

    # -- Step 7: Build and send email ------------------------------------
    top_jobs = jobs[:MAX_EMAIL_JOBS]
    print(f"\n[EMAIL] Building digest for {len(top_jobs)} jobs (quota: {MAX_EMAIL_JOBS})...")

    html = build_html_email(
        top_jobs,
        job_title,
        freshers_only=freshers_only,
        min_stars=min_stars,
    )
    badge_str = " (Freshers Only)" if freshers_only else ""
    subject = f"🚀 {len(top_jobs)} {job_title} Roles{badge_str} · {min_stars}+ ⭐ · Xphire AI"

    send_email(html, subject, recipient_email)
    print("\n[COMPLETE] Unified pipeline finished successfully.")


if __name__ == "__main__":
    asyncio.run(main())
