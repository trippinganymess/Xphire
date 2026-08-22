"""
Xphire Scheduled Email Dispatcher.

Reads active rows from the `email_subscriptions` Supabase table whose
`preferred_utc_hour` matches the current UTC hour (0, 6, 12, or 18) and
runs the unified email pipeline for each subscription.

Designed to be invoked by .github/workflows/schedule_jobs.yml which is
triggered on the cron schedule:  0 0,6,12,18 * * *
"""

import os
import asyncio
import httpx
from datetime import datetime, timezone
from typing import List, Dict, Any


SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")


# ============================================================================
# FETCH SUBSCRIPTIONS
# ============================================================================
async def fetch_subscriptions(utc_hour: int) -> List[Dict[str, Any]]:
    """Return all active subscriptions scheduled for this UTC hour."""
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        print("[SCHEDULE] Missing Supabase credentials. Aborting.")
        return []

    headers = {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type": "application/json",
    }
    url = (
        f"{SUPABASE_URL.rstrip('/')}/rest/v1/email_subscriptions"
        f"?select=*"
        f"&active=eq.true"
        f"&preferred_utc_hour=eq.{utc_hour}"
    )

    async with httpx.AsyncClient() as client:
        try:
            resp = await client.get(url, headers=headers, timeout=10.0)
            if resp.status_code == 200:
                rows = resp.json()
                print(f"[SCHEDULE] {len(rows)} active subscription(s) for UTC {utc_hour:02d}:00.")
                return rows
            else:
                print(f"[SCHEDULE] Failed to fetch subscriptions: {resp.status_code} {resp.text}")
                return []
        except Exception as exc:
            print(f"[SCHEDULE] Error fetching subscriptions: {exc}")
            return []


# ============================================================================
# DISPATCH PIPELINE PER SUBSCRIPTION
# ============================================================================
async def run_pipeline_for_subscription(sub: Dict[str, Any]) -> None:
    """Set env vars from subscription and run the email pipeline."""
    # Import here so env vars are read fresh per subscription
    from worker_email import main as email_main

    os.environ["JOB_TITLE"]       = sub["job_title"]
    os.environ["RECIPIENT_EMAIL"] = sub["recipient_email"]
    os.environ["FRESHERS_ONLY"]   = str(sub.get("freshers_only", False)).lower()
    os.environ["MIN_STARS"]       = str(sub.get("min_stars", 3))

    print(
        f"\n{'=' * 60}\n"
        f"[SCHEDULE] Processing subscription: {sub.get('id', 'N/A')}\n"
        f"  Recipient : {sub['recipient_email']}\n"
        f"  Job Title : {sub['job_title']}\n"
        f"  Freshers  : {sub.get('freshers_only', False)}\n"
        f"  Min Stars : {sub.get('min_stars', 3)}★\n"
        f"{'=' * 60}"
    )

    try:
        await email_main()
    except Exception as exc:
        print(f"[SCHEDULE] Pipeline failed for subscription {sub.get('id')}: {exc}")


# ============================================================================
# MAIN
# ============================================================================
async def main() -> None:
    now_utc = datetime.now(timezone.utc)
    utc_hour = now_utc.hour

    print("=" * 60)
    print("  Xphire Scheduled Email Dispatcher")
    print(f"  UTC Time : {now_utc.strftime('%Y-%m-%dT%H:%M:%SZ')}")
    print(f"  UTC Hour : {utc_hour:02d}:00")
    print("=" * 60)

    subscriptions = await fetch_subscriptions(utc_hour)

    if not subscriptions:
        print("[SCHEDULE] No active subscriptions for this time slot. Done.")
        return

    for sub in subscriptions:
        await run_pipeline_for_subscription(sub)

    print(f"\n[SCHEDULE] Finished. Processed {len(subscriptions)} subscription(s).")


if __name__ == "__main__":
    asyncio.run(main())
