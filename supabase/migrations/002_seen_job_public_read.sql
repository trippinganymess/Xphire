-- Enable public read access for the Job Board
CREATE POLICY "Public read access for job board"
  ON "Seen_job"
  FOR SELECT
  USING (true);
