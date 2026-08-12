-- Restore exact city-id parity with the canonical TypeScript collectionCityId
-- without rewriting the already-applied 0057/0058 migrations. PostgreSQL's
-- NFD normalization makes both precomposed and decomposed Portuguese accents
-- follow the same lower -> NFD -> combining-mark removal order as TypeScript.
CREATE OR REPLACE FUNCTION lead_finder_internal.enqueue_collection_job(
  p_request_identity text,
  p_payload jsonb
)
RETURNS TABLE(id uuid, status text, replayed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  identity_date_text text;
  identity_slot text;
  identity_city_id text;
  identity_policy_version text;
  identity_date date;
  input_payload jsonb;
  payload_city text;
  payload_state text;
  payload_city_id text;
  payload_city_normalized text;
  payload_state_normalized text;
  payload_limit text;
  existing_batch record;
  inserted_job record;
BEGIN
  IF p_request_identity IS NULL
    OR p_request_identity !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[|](09|13|16)[|][a-z0-9]+(-[a-z0-9]+)*[|]daily6-v1$'
  THEN
    RAISE EXCEPTION 'COLLECTION_IDENTITY_INVALID' USING ERRCODE = '22023';
  END IF;

  identity_date_text := split_part(p_request_identity, '|', 1);
  identity_slot := split_part(p_request_identity, '|', 2);
  identity_city_id := split_part(p_request_identity, '|', 3);
  identity_policy_version := split_part(p_request_identity, '|', 4);

  BEGIN
    identity_date := identity_date_text::date;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'COLLECTION_IDENTITY_INVALID' USING ERRCODE = '22023';
  END;
  IF to_char(identity_date, 'YYYY-MM-DD') IS DISTINCT FROM identity_date_text
    OR identity_policy_version IS DISTINCT FROM 'daily6-v1'
    OR (
      identity_slot IS DISTINCT FROM '09'
      AND identity_slot IS DISTINCT FROM '13'
      AND identity_slot IS DISTINCT FROM '16'
    )
  THEN
    RAISE EXCEPTION 'COLLECTION_IDENTITY_INVALID' USING ERRCODE = '22023';
  END IF;

  -- Preserve every null-safe authorization check introduced by 0058. Missing
  -- keys, JSON nulls, wrong types, and wrong values reject before any write.
  IF p_payload IS NULL
    OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object'
    OR NOT (p_payload ? 'collectionEgress')
    OR jsonb_typeof(p_payload->'collectionEgress') IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_payload->'collectionEgress'->'enabled') IS DISTINCT FROM 'boolean'
    OR (p_payload->'collectionEgress'->'enabled') IS DISTINCT FROM 'true'::jsonb
    OR jsonb_typeof(p_payload->'collectionEgress'->'configurationVersion') IS DISTINCT FROM 'number'
    OR (p_payload->'collectionEgress'->'configurationVersion') IS DISTINCT FROM '1'::jsonb
    OR NOT (p_payload ? 'collectionRequestIdentity')
    OR (p_payload->>'collectionRequestIdentity') IS DISTINCT FROM p_request_identity
    OR NOT (p_payload ? 'input')
    OR jsonb_typeof(p_payload->'input') IS DISTINCT FROM 'object'
  THEN
    RAISE EXCEPTION 'COLLECTION_PAYLOAD_INVALID' USING ERRCODE = '22023';
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
    RAISE EXCEPTION 'COLLECTION_PAYLOAD_INVALID' USING ERRCODE = '22023';
  END IF;

  -- Equivalent to collectionCityId(city, state): trim happened above; city is
  -- lowercased, normalized to NFD, stripped of U+0300..U+036F combining marks,
  -- and slugged. State intentionally is not NFD-normalized, matching TypeScript.
  payload_city_normalized := regexp_replace(
    regexp_replace(
      regexp_replace(
        normalize(lower(payload_city), NFD),
        '[' || chr(768) || '-' || chr(879) || ']', '', 'g'),
      '[^a-z0-9]+', '-', 'g'),
    '(^-+|-+$)', '', 'g');
  payload_city_normalized := regexp_replace(payload_city_normalized, '-+', '-', 'g');
  payload_state_normalized := regexp_replace(lower(payload_state), '[^a-z0-9]+', '', 'g');
  payload_city_id := regexp_replace(
    regexp_replace(payload_city_normalized || '-' || payload_state_normalized, '-+', '-', 'g'),
    '(^-+|-+$)', '', 'g');

  IF payload_city_id IS DISTINCT FROM identity_city_id THEN
    RAISE EXCEPTION 'COLLECTION_IDENTITY_CITY_MISMATCH' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.daily6_batches(batch_id, batch_date, slot, city_id, policy_version)
  VALUES (p_request_identity, identity_date, identity_slot, identity_city_id, identity_policy_version)
  ON CONFLICT (batch_id) DO NOTHING;

  SELECT batch_date, slot, city_id, policy_version
    INTO existing_batch
  FROM public.daily6_batches
  WHERE batch_id = p_request_identity
  FOR UPDATE;
  IF NOT FOUND
    OR existing_batch.batch_date <> identity_date
    OR existing_batch.slot <> identity_slot
    OR existing_batch.city_id <> identity_city_id
    OR existing_batch.policy_version <> identity_policy_version
  THEN
    RAISE EXCEPTION 'COLLECTION_BATCH_CONTRACT_MISMATCH' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.collection_jobs(request_identity, payload)
  VALUES (p_request_identity, p_payload)
  ON CONFLICT (request_identity) WHERE request_identity IS NOT NULL DO NOTHING
  RETURNING collection_jobs.id, collection_jobs.status
    INTO inserted_job;

  IF FOUND THEN
    RETURN QUERY SELECT inserted_job.id, inserted_job.status, false;
    RETURN;
  END IF;

  SELECT collection_jobs.id, collection_jobs.status
    INTO inserted_job
  FROM public.collection_jobs
  WHERE request_identity = p_request_identity
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'COLLECTION_IDEMPOTENCY_RACE' USING ERRCODE = '40001';
  END IF;
  RETURN QUERY SELECT inserted_job.id, inserted_job.status, true;
END;
$$;

REVOKE ALL ON FUNCTION lead_finder_internal.enqueue_collection_job(text, jsonb) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION lead_finder_internal.enqueue_collection_job(text, jsonb) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION lead_finder_internal.enqueue_collection_job(text, jsonb) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    REVOKE ALL ON FUNCTION lead_finder_internal.enqueue_collection_job(text, jsonb) FROM service_role;
  END IF;
END $$;
