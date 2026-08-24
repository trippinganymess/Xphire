-- Allow any unauthenticated visitor to read the Seen_job table
-- so the public job board can display scraped jobs.
DROP POLICY IF EXISTS "Public read access for job board" ON "Seen_job";
CREATE POLICY "Public read access for job board" ON "Seen_job"
    FOR SELECT
    USING (true);
