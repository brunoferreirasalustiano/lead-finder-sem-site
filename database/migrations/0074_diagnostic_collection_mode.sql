BEGIN;

ALTER TABLE public.collection_jobs
  ADD COLUMN IF NOT EXISTS request_mode text;

UPDATE public.collection_jobs
SET request_mode = CASE
  WHEN request_identity ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[|](09|13|16)[|][a-z0-9]+(-[a-z0-9]+)*[|]daily6-v1$'
    THEN 'COMMERCIAL'
  ELSE 'LEGACY'
END
WHERE request_mode IS NULL;

ALTER TABLE public.collection_jobs
  ALTER COLUMN request_mode SET DEFAULT 'COMMERCIAL',
  ALTER COLUMN request_mode SET NOT NULL;

-- Migration 0053 limited every non-null identity to the commercial Daily-6
-- namespace. Replace that historical guard before adding the mode-aware guard
-- so diagnostic jobs cannot be rejected by an obsolete constraint.
ALTER TABLE public.collection_jobs
  DROP CONSTRAINT IF EXISTS collection_jobs_request_identity_check;
ALTER TABLE public.collection_jobs
  ADD CONSTRAINT collection_jobs_request_identity_check CHECK (
    request_identity IS NULL
    OR request_identity ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[|](09|13|16)[|][a-z0-9]+(-[a-z0-9]+)*[|]daily6-v1$'
    OR request_identity ~ '^diagnostic[|][0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[|][a-z0-9]+(-[a-z0-9]+)*[|]discovery-v1$'
  );

ALTER TABLE public.collection_jobs
  DROP CONSTRAINT IF EXISTS collection_jobs_request_mode_check;
ALTER TABLE public.collection_jobs
  ADD CONSTRAINT collection_jobs_request_mode_check CHECK (
    (request_mode = 'LEGACY'
      AND (
        request_identity IS NULL
        OR (
          request_identity !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[|](09|13|16)[|][a-z0-9]+(-[a-z0-9]+)*[|]daily6-v1$'
          AND request_identity !~ '^diagnostic[|]'
        )
      )
    )
    OR (
      request_mode = 'COMMERCIAL'
      AND request_identity ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[|](09|13|16)[|][a-z0-9]+(-[a-z0-9]+)*[|]daily6-v1$'
    )
    OR (
      request_mode = 'DIAGNOSTIC'
      AND request_identity ~ '^diagnostic[|][0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[|][a-z0-9]+(-[a-z0-9]+)*[|]discovery-v1$'
    )
  );

CREATE OR REPLACE FUNCTION lead_finder_internal.prevent_collection_execution_identity_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.request_identity IS DISTINCT FROM OLD.request_identity
    OR NEW.request_mode IS DISTINCT FROM OLD.request_mode
  THEN
    RAISE EXCEPTION 'COLLECTION_EXECUTION_IDENTITY_IMMUTABLE' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS collection_execution_identity_immutable ON public.collection_jobs;
CREATE TRIGGER collection_execution_identity_immutable
BEFORE UPDATE OF request_identity, request_mode ON public.collection_jobs
FOR EACH ROW EXECUTE FUNCTION lead_finder_internal.prevent_collection_execution_identity_mutation();

CREATE OR REPLACE FUNCTION lead_finder_internal.enqueue_diagnostic_collection_job(
  p_request_identity text,
  p_payload jsonb
)
RETURNS TABLE(id uuid, status text, replayed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  identity_city_id text;
  input_payload jsonb;
  payload_city text;
  payload_state text;
  payload_city_id text;
  payload_limit text;
  inserted_job record;
BEGIN
  IF p_request_identity IS NULL
    OR p_request_identity !~ '^diagnostic[|][0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[|][a-z0-9]+(-[a-z0-9]+)*[|]discovery-v1$'
  THEN
    RAISE EXCEPTION 'DIAGNOSTIC_COLLECTION_IDENTITY_INVALID' USING ERRCODE = '22023';
  END IF;
  identity_city_id := split_part(p_request_identity, '|', 3);

  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object'
    OR jsonb_typeof(p_payload->'input') <> 'object'
    OR (p_payload->>'collectionRequestIdentity') IS DISTINCT FROM p_request_identity
    OR p_payload->>'requestMode' <> 'DIAGNOSTIC'
    OR p_payload->'collectionEgress'->>'enabled' <> 'true'
    OR p_payload->'collectionEgress'->>'configurationVersion' <> '1'
  THEN
    RAISE EXCEPTION 'DIAGNOSTIC_COLLECTION_PAYLOAD_INVALID' USING ERRCODE = '22023';
  END IF;

  input_payload := p_payload->'input';
  payload_city := btrim(coalesce(input_payload->>'city', ''));
  payload_state := btrim(coalesce(input_payload->>'state', ''));
  payload_limit := input_payload->>'limit';
  IF char_length(payload_city) NOT BETWEEN 2 AND 100
    OR char_length(payload_state) NOT BETWEEN 2 AND 50
    OR char_length(btrim(coalesce(input_payload->>'country', ''))) NOT BETWEEN 2 AND 80
    OR btrim(coalesce(input_payload->>'category', '')) NOT IN (
      'oficinas', 'autoeletricas', 'saloes-de-beleza', 'barbearias',
      'clinicas', 'consultorios', 'restaurantes', 'lanchonetes',
      'empresas-de-seguranca', 'prestadores-de-servicos'
    )
    OR payload_limit IS NULL OR payload_limit !~ '^[0-9]+$'
    OR payload_limit::integer NOT BETWEEN 1 AND 50
  THEN
    RAISE EXCEPTION 'DIAGNOSTIC_COLLECTION_PAYLOAD_INVALID' USING ERRCODE = '22023';
  END IF;

  payload_city_id := regexp_replace(
    regexp_replace(
      lower(translate(payload_city || '-' || payload_state,
        chr(225)||chr(224)||chr(227)||chr(226)||chr(228)||chr(233)||chr(232)||chr(234)||chr(235)||chr(237)||chr(236)||chr(238)||chr(239)||chr(243)||chr(242)||chr(245)||chr(244)||chr(246)||chr(250)||chr(249)||chr(251)||chr(252)||chr(231)||chr(241)||
        chr(193)||chr(192)||chr(195)||chr(194)||chr(196)||chr(201)||chr(200)||chr(202)||chr(203)||chr(205)||chr(204)||chr(206)||chr(207)||chr(211)||chr(210)||chr(213)||chr(212)||chr(214)||chr(218)||chr(217)||chr(219)||chr(220)||chr(199)||chr(209),
        'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN')),
      '[^a-z0-9]+', '-', 'g'),
    '(^-+|-+$)', '', 'g');
  payload_city_id := regexp_replace(payload_city_id, '-+', '-', 'g');
  IF payload_city_id <> identity_city_id THEN
    RAISE EXCEPTION 'DIAGNOSTIC_COLLECTION_IDENTITY_CITY_MISMATCH' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.collection_jobs(request_identity, request_mode, payload)
  VALUES (p_request_identity, 'DIAGNOSTIC', p_payload)
  ON CONFLICT (request_identity) WHERE request_identity IS NOT NULL DO NOTHING
  RETURNING collection_jobs.id, collection_jobs.status INTO inserted_job;

  IF FOUND THEN
    RETURN QUERY SELECT inserted_job.id, inserted_job.status, false;
    RETURN;
  END IF;

  SELECT collection_jobs.id, collection_jobs.status INTO inserted_job
  FROM public.collection_jobs
  WHERE request_identity = p_request_identity
    AND request_mode = 'DIAGNOSTIC'
    AND payload = p_payload
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DIAGNOSTIC_COLLECTION_IDEMPOTENCY_CONFLICT' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY SELECT inserted_job.id, inserted_job.status, true;
END;
$$;

CREATE OR REPLACE FUNCTION lead_finder_internal.reject_diagnostic_commercial_side_effect()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  execution_identity text;
BEGIN
  execution_identity := CASE TG_TABLE_NAME
    WHEN 'daily6_batches' THEN to_jsonb(NEW)->>'batch_id'
    WHEN 'daily6_send_ledger' THEN to_jsonb(NEW)->>'batch_id'
    WHEN 'campaign_outbox' THEN to_jsonb(NEW)->>'idempotency_key'
    WHEN 'pilot_runs' THEN to_jsonb(NEW)->>'name'
    ELSE NULL
  END;
  IF execution_identity LIKE 'diagnostic|%' OR execution_identity LIKE 'daily6:diagnostic|%' THEN
    RAISE EXCEPTION 'DIAGNOSTIC_COMMERCIAL_SIDE_EFFECT_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION lead_finder_internal.get_diagnostic_commercial_snapshot()
RETURNS TABLE(
  daily6_batches_count bigint,
  daily6_send_ledger_count bigint,
  campaign_outbox_count bigint,
  manual_email_send_attempts_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    (SELECT count(*) FROM public.daily6_batches),
    (SELECT count(*) FROM public.daily6_send_ledger),
    (SELECT count(*) FROM public.campaign_outbox),
    (SELECT count(*) FROM public.pilot_manual_email_send_attempts)
$$;

DROP TRIGGER IF EXISTS diagnostic_daily6_batch_guard ON public.daily6_batches;
CREATE TRIGGER diagnostic_daily6_batch_guard BEFORE INSERT ON public.daily6_batches
FOR EACH ROW EXECUTE FUNCTION lead_finder_internal.reject_diagnostic_commercial_side_effect();
DROP TRIGGER IF EXISTS diagnostic_daily6_ledger_guard ON public.daily6_send_ledger;
CREATE TRIGGER diagnostic_daily6_ledger_guard BEFORE INSERT ON public.daily6_send_ledger
FOR EACH ROW EXECUTE FUNCTION lead_finder_internal.reject_diagnostic_commercial_side_effect();
DROP TRIGGER IF EXISTS diagnostic_campaign_outbox_guard ON public.campaign_outbox;
CREATE TRIGGER diagnostic_campaign_outbox_guard BEFORE INSERT ON public.campaign_outbox
FOR EACH ROW EXECUTE FUNCTION lead_finder_internal.reject_diagnostic_commercial_side_effect();
DROP TRIGGER IF EXISTS diagnostic_pilot_run_guard ON public.pilot_runs;
CREATE TRIGGER diagnostic_pilot_run_guard BEFORE INSERT ON public.pilot_runs
FOR EACH ROW EXECUTE FUNCTION lead_finder_internal.reject_diagnostic_commercial_side_effect();

REVOKE ALL ON FUNCTION lead_finder_internal.enqueue_diagnostic_collection_job(text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION lead_finder_internal.prevent_collection_execution_identity_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION lead_finder_internal.reject_diagnostic_commercial_side_effect() FROM PUBLIC;
REVOKE ALL ON FUNCTION lead_finder_internal.get_diagnostic_commercial_snapshot() FROM PUBLIC;

COMMIT;
