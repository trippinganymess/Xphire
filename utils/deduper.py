import os
import hashlib
import httpx
from typing import List, Dict, Any

class Deduper:
    def __init__(self):
        self.supabase_url = os.environ.get("SUPABASE_URL")
        self.supabase_key = os.environ.get("SUPABASE_KEY")
        
        self.headers = {
            "apikey": self.supabase_key,
            "Authorization": f"Bearer {self.supabase_key}",
            "Content-Type": "application/json"
        } if self.supabase_key else {}

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
            url = f"{self.supabase_url.rstrip('/')}/rest/v1/seen_jobs?select=job_id&job_id=in.({ids_str})"
            
            try:
                resp = await client.get(url, headers=self.headers, timeout=10.0)
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
        """Inserts newly processed job_ids into Supabase."""
        if not self.supabase_url or not self.supabase_key or not jobs:
            return

        headers = {**self.headers, "Prefer": "resolution=ignore-duplicates"}
        url = f"{self.supabase_url.rstrip('/')}/rest/v1/seen_jobs"
        
        payload = [{"job_id": job["job_id"]} for job in jobs]

        for i in range(0, len(payload), 100):
            chunk = payload[i:i + 100]
            try:
                resp = await client.post(url, headers=headers, json=chunk, timeout=10.0)
                if resp.status_code not in (200, 201):
                    print(f"  [ERROR] Failed to save to Supabase ({resp.status_code})")
            except Exception as e:
                print(f"  [ERROR] Supabase insert failed: {e}")