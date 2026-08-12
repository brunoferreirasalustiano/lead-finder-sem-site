-- Keep collection enqueue behind one narrow, atomic database boundary.
-- The API runtime must not receive direct access to either collection_jobs or
-- daily6_batches; only this function is exposed by the HML security supplement.
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
  IF to_char(identity_date, 'YYYY-MM-DD') <> identity_date_text
    OR identity_policy_version <> 'daily6-v1'
    OR identity_slot NOT IN ('09', '13', '16')
  THEN
    RAISE EXCEPTION 'COLLECTION_IDENTITY_INVALID' USING ERRCODE = '22023';
  END IF;

  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object'
    OR jsonb_typeof(p_payload->'input') <> 'object'
    OR p_payload->>'collectionRequestIdentity' <> p_request_identity
    OR p_payload->'collectionEgress'->>'enabled' <> 'true'
    OR p_payload->'collectionEgress'->>'configurationVersion' <> '1'
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

  -- Match the shared city-id normalization for the public city/state fields.
  -- chr() keeps the migration ASCII-safe while covering Portuguese accents.
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

