import os
import hashlib
# pyrefly: ignore [missing-import]
import httpx
from typing import List, Dict, Any

class Deduper:
    def __init__(self):
        self.supabase_url = os.environ.get("SUPABASE_URL")
        self.supabase_key = os.environ.get("SUPABASE_KEY")
        # Service role key bypasses Row Level Security - required for INSERT.
        # Falls back to anon key if not set (reads still work, writes may 404).
        self.service_key = os.environ.get("SUPABASE_SERVICE_KEY") or self.supabase_key

        self.read_headers = {
            "apikey": self.supabase_key,
            "Authorization": f"Bearer {self.supabase_key}",
            "Content-Type": "application/json",
        } if self.supabase_key else {}

        self.write_headers = {
            "apikey": self.service_key,
            "Authorization": f"Bearer {self.service_key}",
            "Content-Type": "application/json",
        } if self.service_key else {}


    @staticmethod
    def generate_job_id(company: str, title: str, url: str) -> str:
        """Generates a deterministic 32-char SHA-256 hash."""
        company_str = str(company or "").lower().strip()
        title_str = str(title or "").lower().strip()
        url_str = str(url or "").strip()
        raw_str = f"{company_str}:{title_str}:{url_str}"
        return hashlib.sha256(raw_str.encode("utf-8")).hexdigest()[:32]

    def _inject_ids(self, jobs: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Ensures every job dictionary has a 'job_id' key."""
        for job in jobs:
            if "job_id" not in job:
                job["job_id"] = self.generate_job_id(
                    job.get("company"), job.get("title"), job.get("url")
                )
        return jobs

    async def get_unseen_jobs(self, client: httpx.AsyncClient, scraped_jobs: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Performs A - B Set Difference with Supabase."""
        if not self.supabase_url or not self.supabase_key or not scraped_jobs:
            print("[WARN] Supabase credentials missing. Returning all jobs as new.")
            return scraped_jobs

        scraped_jobs = self._inject_ids(scraped_jobs)
        scraped_ids = [job["job_id"] for job in scraped_jobs]
        existing_ids = set()

        for i in range(0, len(scraped_ids), 100):
            chunk = scraped_ids[i:i + 100]
            ids_str = ",".join(chunk)
            url = f"{self.supabase_url.rstrip('/')}/rest/v1/Seen_job?select=job_id&job_id=in.({ids_str})"
            
            try:
                resp = await client.get(url, headers=self.read_headers, timeout=10.0)
                if resp.status_code == 200:
                    for row in resp.json():
                        existing_ids.add(row["job_id"])
            except Exception as e:
                print(f"[WARN] Supabase deduplication error: {e}")

        new_jobs = [job for job in scraped_jobs if job["job_id"] not in existing_ids]

        print("-" * 60)
        print(f"[DEDUPLICATION SUMMARY]")
        print(f"  -> Total Extracted (Set A): {len(scraped_jobs)}")
        print(f"  -> Found in Database (Set B): {len(existing_ids)}")
        print(f"  -> New Jobs to Sync (A - B): {len(new_jobs)}")
        print("-" * 60)

        return new_jobs

    async def save_seen_jobs(self, client: httpx.AsyncClient, jobs: List[Dict[str, Any]]):
        """
        Upsert fully enriched job records into Supabase.

        Persists: job_id, company, title, url, location, experience,
                  salary, source, rating.

        Uses 'resolution=merge-duplicates' so subsequent pipeline runs
        update stale records rather than erroring on PK conflicts.

        NOTE: The Seen_job table must have the extra columns. Run this
        migration in Supabase SQL Editor if not yet applied:

            ALTER TABLE "Seen_job"
              ADD COLUMN IF NOT EXISTS company    TEXT,
              ADD COLUMN IF NOT EXISTS title      TEXT,
              ADD COLUMN IF NOT EXISTS url        TEXT,
              ADD COLUMN IF NOT EXISTS location   TEXT,
              ADD COLUMN IF NOT EXISTS experience TEXT,
              ADD COLUMN IF NOT EXISTS salary     TEXT,
              ADD COLUMN IF NOT EXISTS source     TEXT,
              ADD COLUMN IF NOT EXISTS rating     INTEGER,
              ADD COLUMN IF NOT EXISTS scraped_at TIMESTAMPTZ DEFAULT now();
        """
        if not self.supabase_url or not self.supabase_key or not jobs:
            return

        headers = {**self.write_headers, "Prefer": "resolution=merge-duplicates"}
        url = f"{self.supabase_url.rstrip('/')}/rest/v1/Seen_job"

        from datetime import datetime, timezone
        now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

        payload = [
            {
                "job_id":     job.get("job_id", ""),
                "company":    job.get("company", ""),
                "title":      job.get("title", ""),
                "url":        job.get("url", ""),
                "location":   job.get("location", ""),
                "experience": job.get("experience", ""),
                "salary":     job.get("salary", ""),
                "source":     job.get("source", ""),
                "rating":     job.get("rating", 3),
                "scraped_at": now_iso,
            }
            for job in jobs
        ]

        # ------------------------------------------------------------------
        # Pre-save deduplication: remove duplicate job_id entries within the
        # same batch to avoid Postgres error 21000 (ON CONFLICT DO UPDATE
        # command cannot affect row a second time).
        # ------------------------------------------------------------------
        seen_ids = set()
        unique_payload = []
        for item in payload:
            jid = item["job_id"]
            if jid not in seen_ids:
                seen_ids.add(jid)
                unique_payload.append(item)
        payload = unique_payload

        for i in range(0, len(payload), 100):
            chunk = payload[i : i + 100]
            try:
                resp = await client.post(url, headers=headers, json=chunk, timeout=10.0)
                if resp.status_code in (200, 201):
                    print(f"  [SUPABASE] Saved {len(chunk)} enriched records.")
                elif resp.status_code == 400 and "PGRST204" in resp.text:
                    # Table exists but extra columns (company, title, etc.) aren't created yet.
                    # Fallback to minimal payload (job_id only) so deduplication vault still works!
                    print(f"  [SUPABASE] Extra columns missing in 'Seen_job' table. Falling back to minimal job_id schema...")
                    min_headers = {**self.write_headers, "Prefer": "resolution=ignore-duplicates"}
                    min_payload = [{"job_id": job["job_id"]} for job in chunk]
                    min_resp = await client.post(url, headers=min_headers, json=min_payload, timeout=10.0)
                    if min_resp.status_code in (200, 201):
                        print(f"  [SUPABASE] Saved {len(chunk)} job IDs (minimal schema).")
                    else:
                        print(f"  [ERROR] Failed to save minimal schema to Supabase ({min_resp.status_code}): {min_resp.text}")
                else:
                    print(f"  [ERROR] Failed to save to Supabase ({resp.status_code}): {resp.text}")
            except Exception as exc:
                print(f"  [ERROR] Supabase insert failed: {exc}")
