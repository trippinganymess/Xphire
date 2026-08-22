-- email_subscriptions table
-- One active subscription per user (enforced by UNIQUE on user_id).
-- preferred_utc_hour must be one of the 4 cron slots: 0, 6, 12, 18.

CREATE TABLE IF NOT EXISTS email_subscriptions (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_email    TEXT        NOT NULL,
  job_title          TEXT        NOT NULL,
  freshers_only      BOOLEAN     NOT NULL DEFAULT false,
  min_stars          INTEGER     NOT NULL DEFAULT 3 CHECK (min_stars BETWEEN 1 AND 5),
  preferred_utc_hour INTEGER     NOT NULL DEFAULT 0  CHECK (preferred_utc_hour IN (0, 6, 12, 18)),
  active             BOOLEAN     NOT NULL DEFAULT true,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only one subscription per user (upsert on conflict)
CREATE UNIQUE INDEX IF NOT EXISTS email_subscriptions_user_id_idx
  ON email_subscriptions (user_id);

-- RLS: users can only read/write their own subscription row
ALTER TABLE email_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own subscription"
  ON email_subscriptions
  FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
