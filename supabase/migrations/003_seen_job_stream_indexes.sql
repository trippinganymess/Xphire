-- Indexes supporting the 24-hour, rating-first job stream.
-- `IF NOT EXISTS` keeps this migration safe to re-run in development.
CREATE INDEX IF NOT EXISTS idx_seen_job_24h_rating
  ON public."Seen_job" (created_at DESC, rating DESC);

CREATE INDEX IF NOT EXISTS idx_seen_job_24h_exp
  ON public."Seen_job" (created_at DESC, experience);
