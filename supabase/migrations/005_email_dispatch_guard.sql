-- Durable admission control for authenticated one-time email workflow dispatches.
-- The singleton quota row serializes reservations, making per-user and global limits atomic.
CREATE TABLE IF NOT EXISTS public.email_dispatch_guard (
  singleton BOOLEAN PRIMARY KEY DEFAULT true CHECK (singleton),
  created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);
INSERT INTO public.email_dispatch_guard (singleton) VALUES (true) ON CONFLICT (singleton) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.email_dispatch_reservations (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  idempotency_key UUID NOT NULL,
  payload_hash TEXT NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  status TEXT NOT NULL CHECK (status IN ('reserved', 'accepted', 'rejected')),
  attempt_count INTEGER NOT NULL DEFAULT 1 CHECK (attempt_count > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
  PRIMARY KEY (user_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS email_dispatch_reservations_created_at_idx
  ON public.email_dispatch_reservations (created_at);
CREATE INDEX IF NOT EXISTS email_dispatch_reservations_user_created_at_idx
  ON public.email_dispatch_reservations (user_id, created_at);
CREATE TABLE IF NOT EXISTS public.email_dispatch_attempts (
  user_id UUID NOT NULL,
  idempotency_key UUID NOT NULL,
  attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
  PRIMARY KEY (user_id, idempotency_key, attempt_number),
  FOREIGN KEY (user_id, idempotency_key)
    REFERENCES public.email_dispatch_reservations(user_id, idempotency_key) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS email_dispatch_attempts_created_at_idx
  ON public.email_dispatch_attempts (created_at);
CREATE INDEX IF NOT EXISTS email_dispatch_attempts_user_created_at_idx
  ON public.email_dispatch_attempts (user_id, created_at);

ALTER TABLE public.email_dispatch_guard ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_dispatch_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_dispatch_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_dispatch_guard, public.email_dispatch_reservations, public.email_dispatch_attempts FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.acquire_email_dispatch(
  p_user_id UUID,
  p_idempotency_key UUID,
  p_payload_hash TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  prior public.email_dispatch_reservations%ROWTYPE;
  request_count BIGINT;
BEGIN
  IF p_user_id IS NULL OR p_idempotency_key IS NULL OR p_payload_hash IS NULL OR p_payload_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN pg_catalog.jsonb_build_object('status', 'invalid');
  END IF;

  -- Serialize acquisitions globally. This intentionally trades peak dispatch throughput
  -- for a small, explicit 500-per-day site-wide abuse ceiling and race-free quota checks.
  PERFORM 1 FROM public.email_dispatch_guard WHERE singleton = true FOR UPDATE;

  SELECT * INTO prior FROM public.email_dispatch_reservations
   WHERE user_id = p_user_id AND idempotency_key = p_idempotency_key FOR UPDATE;
  IF FOUND THEN
    IF prior.payload_hash <> p_payload_hash THEN
      RETURN pg_catalog.jsonb_build_object('status', 'conflict');
    ELSIF prior.status = 'rejected' THEN
      -- A definite rejection can be retried with the same key, but each actual
      -- provider attempt consumes the same durable cooldown/hour/day budgets.
      SELECT pg_catalog.count(*) INTO request_count FROM public.email_dispatch_attempts
       WHERE user_id = p_user_id AND created_at >= pg_catalog.now() - INTERVAL '1 minute';
      IF request_count >= 1 THEN RETURN pg_catalog.jsonb_build_object('status', 'quota'); END IF;
      SELECT pg_catalog.count(*) INTO request_count FROM public.email_dispatch_attempts
       WHERE user_id = p_user_id AND created_at >= pg_catalog.now() - INTERVAL '1 hour';
      IF request_count >= 3 THEN RETURN pg_catalog.jsonb_build_object('status', 'quota'); END IF;
      SELECT pg_catalog.count(*) INTO request_count FROM public.email_dispatch_attempts
       WHERE user_id = p_user_id AND created_at >= pg_catalog.now() - INTERVAL '1 day';
      IF request_count >= 10 THEN RETURN pg_catalog.jsonb_build_object('status', 'quota'); END IF;
      SELECT pg_catalog.count(*) INTO request_count FROM public.email_dispatch_attempts
       WHERE created_at >= pg_catalog.now() - INTERVAL '1 day';
      IF request_count >= 500 THEN RETURN pg_catalog.jsonb_build_object('status', 'quota'); END IF;
      UPDATE public.email_dispatch_reservations
         SET status = 'reserved', attempt_count = attempt_count + 1, updated_at = pg_catalog.now()
       WHERE user_id = p_user_id AND idempotency_key = p_idempotency_key;
      INSERT INTO public.email_dispatch_attempts (user_id, idempotency_key, attempt_number)
      VALUES (p_user_id, p_idempotency_key, prior.attempt_count + 1);
      RETURN pg_catalog.jsonb_build_object('status', 'acquired');
    ELSE
      RETURN pg_catalog.jsonb_build_object('status', prior.status);
    END IF;
  END IF;

  SELECT pg_catalog.count(*) INTO request_count FROM public.email_dispatch_attempts
   WHERE user_id = p_user_id AND created_at >= pg_catalog.now() - INTERVAL '1 minute';
  IF request_count >= 1 THEN RETURN pg_catalog.jsonb_build_object('status', 'quota'); END IF;
  SELECT pg_catalog.count(*) INTO request_count FROM public.email_dispatch_attempts
   WHERE user_id = p_user_id AND created_at >= pg_catalog.now() - INTERVAL '1 hour';
  IF request_count >= 3 THEN RETURN pg_catalog.jsonb_build_object('status', 'quota'); END IF;
  SELECT pg_catalog.count(*) INTO request_count FROM public.email_dispatch_attempts
   WHERE user_id = p_user_id AND created_at >= pg_catalog.now() - INTERVAL '1 day';
  IF request_count >= 10 THEN RETURN pg_catalog.jsonb_build_object('status', 'quota'); END IF;
  SELECT pg_catalog.count(*) INTO request_count FROM public.email_dispatch_attempts
   WHERE created_at >= pg_catalog.now() - INTERVAL '1 day';
  IF request_count >= 500 THEN RETURN pg_catalog.jsonb_build_object('status', 'quota'); END IF;

  INSERT INTO public.email_dispatch_reservations (user_id, idempotency_key, payload_hash, status)
  VALUES (p_user_id, p_idempotency_key, p_payload_hash, 'reserved');
  INSERT INTO public.email_dispatch_attempts (user_id, idempotency_key, attempt_number)
  VALUES (p_user_id, p_idempotency_key, 1);
  RETURN pg_catalog.jsonb_build_object('status', 'acquired');
END;
$function$;

CREATE OR REPLACE FUNCTION public.complete_email_dispatch(
  p_user_id UUID,
  p_idempotency_key UUID,
  p_status TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF p_status NOT IN ('accepted', 'rejected') THEN RETURN false; END IF;
  UPDATE public.email_dispatch_reservations
     SET status = p_status, updated_at = pg_catalog.now()
   WHERE user_id = p_user_id AND idempotency_key = p_idempotency_key AND status = 'reserved';
  RETURN FOUND;
END;
$function$;

REVOKE ALL ON FUNCTION public.acquire_email_dispatch(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_email_dispatch(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_email_dispatch(UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_email_dispatch(UUID, UUID, TEXT) TO service_role;
