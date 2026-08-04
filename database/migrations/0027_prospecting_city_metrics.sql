BEGIN;

CREATE TABLE IF NOT EXISTS public.prospecting_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_fingerprint text NOT NULL UNIQUE CHECK (execution_fingerprint ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$'),
  campaign_key text NOT NULL DEFAULT 'lead-finder-default' CHECK (campaign_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$'),
  city text NOT NULL CHECK (city IN ('Campinas','Valinhos','Paulínia','Hortolândia','Sumaré','Indaiatuba')),
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  found integer NOT NULL DEFAULT 0 CHECK (found >= 0),
  approved integer NOT NULL DEFAULT 0 CHECK (approved >= 0),
  rejected integer NOT NULL DEFAULT 0 CHECK (rejected >= 0),
  sent_accepted_by_provider integer NOT NULL DEFAULT 0 CHECK (sent_accepted_by_provider >= 0),
  immediate_bounces integer NOT NULL DEFAULT 0 CHECK (immediate_bounces >= 0),
  opt_outs integer NOT NULL DEFAULT 0 CHECK (opt_outs >= 0),
  replies integer NOT NULL DEFAULT 0 CHECK (replies >= 0),
  complaints integer NOT NULL DEFAULT 0 CHECK (complaints >= 0),
  blocked integer NOT NULL DEFAULT 0 CHECK (blocked >= 0),
  duplicates_avoided integer NOT NULL DEFAULT 0 CHECK (duplicates_avoided >= 0),
  score_0_59 integer NOT NULL DEFAULT 0 CHECK (score_0_59 >= 0),
  score_60_79 integer NOT NULL DEFAULT 0 CHECK (score_60_79 >= 0),
  score_80_99 integer NOT NULL DEFAULT 0 CHECK (score_80_99 >= 0),
  score_100 integer NOT NULL DEFAULT 0 CHECK (score_100 >= 0),
  approval_rate numeric(8,7) NOT NULL DEFAULT 0 CHECK (approval_rate >= 0 AND approval_rate <= 1),
  rejection_rate numeric(8,7) NOT NULL DEFAULT 0 CHECK (rejection_rate >= 0 AND rejection_rate <= 1),
  send_rate_among_approved numeric(8,7) NOT NULL DEFAULT 0 CHECK (send_rate_among_approved >= 0 AND send_rate_among_approved <= 1),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (completed_at IS NULL OR completed_at >= started_at),
  CHECK (approved + rejected <= found),
  CHECK (sent_accepted_by_provider <= approved),
  CHECK (score_0_59 + score_60_79 + score_80_99 + score_100 = found)
);

CREATE INDEX IF NOT EXISTS prospecting_runs_campaign_city_created_idx
  ON public.prospecting_runs(campaign_key, city, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS public.prospecting_run_rejection_reasons (
  run_id uuid NOT NULL REFERENCES public.prospecting_runs(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (reason IN (
    'PREVIOUS_CONTACT','DUPLICATE','OFFICIAL_SITE','BUSINESS_EMAIL_NOT_FOUND',
    'BUSINESS_EMAIL_UNCERTAIN','INACTIVE','AMBIGUOUS','BOUNCE','OPT_OUT',
    'DO_NOT_CONTACT','NAO_CONTATAR','BLOCKED','COMPLAINT','AUDIT_FAILURE',
    'SCORE_BELOW_THRESHOLD','OTHER'
  )),
  count integer NOT NULL DEFAULT 0 CHECK (count >= 0),
  PRIMARY KEY (run_id, reason)
);

CREATE TABLE IF NOT EXISTS public.prospecting_city_state (
  campaign_key text PRIMARY KEY CHECK (campaign_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$'),
  current_city text NOT NULL CHECK (current_city IN ('Campinas','Valinhos','Paulínia','Hortolândia','Sumaré','Indaiatuba')),
  consecutive_low_yield_runs integer NOT NULL DEFAULT 0 CHECK (consecutive_low_yield_runs >= 0),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS public.prospecting_city_transitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_key text NOT NULL CHECK (campaign_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$'),
  from_city text NOT NULL CHECK (from_city IN ('Campinas','Valinhos','Paulínia','Hortolândia','Sumaré','Indaiatuba')),
  to_city text NOT NULL CHECK (to_city IN ('Campinas','Valinhos','Paulínia','Hortolândia','Sumaré','Indaiatuba')),
  reason text NOT NULL CHECK (reason ~ '^[A-Z][A-Z0-9_]{0,99}$'),
  triggering_run_id uuid REFERENCES public.prospecting_runs(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (campaign_key, from_city, to_city, triggering_run_id),
  CHECK (from_city <> to_city)
);

CREATE INDEX IF NOT EXISTS prospecting_city_transitions_campaign_created_idx
  ON public.prospecting_city_transitions(campaign_key, created_at DESC, id DESC);

CREATE OR REPLACE FUNCTION public.prospecting_validate_transition()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  ordered text[] := ARRAY['Campinas','Valinhos','Paulínia','Hortolândia','Sumaré','Indaiatuba'];
BEGIN
  IF array_position(ordered, NEW.to_city) <> array_position(ordered, NEW.from_city) + 1 THEN
    RAISE EXCEPTION 'prospecting city transitions must advance exactly one configured city' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS prospecting_city_transition_guard ON public.prospecting_city_transitions;
CREATE TRIGGER prospecting_city_transition_guard
  BEFORE INSERT OR UPDATE ON public.prospecting_city_transitions
  FOR EACH ROW EXECUTE FUNCTION public.prospecting_validate_transition();

CREATE OR REPLACE FUNCTION public.prospecting_city_state_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  ordered text[] := ARRAY['Campinas','Valinhos','Paulínia','Hortolândia','Sumaré','Indaiatuba'];
BEGIN
  IF array_position(ordered, NEW.current_city) < array_position(ordered, OLD.current_city)
    OR array_position(ordered, NEW.current_city) > array_position(ordered, OLD.current_city) + 1
    OR NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'prospecting city state must move monotonically by one position' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS prospecting_city_state_guard ON public.prospecting_city_state;
CREATE TRIGGER prospecting_city_state_guard
  BEFORE UPDATE ON public.prospecting_city_state
  FOR EACH ROW EXECUTE FUNCTION public.prospecting_city_state_guard();

CREATE OR REPLACE FUNCTION public.prospecting_append_only_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  RAISE EXCEPTION '% is append-only' USING ERRCODE = '55000', HINT = 'Create a new run instead of mutating history';
END
$$;

DROP TRIGGER IF EXISTS prospecting_runs_append_only ON public.prospecting_runs;
CREATE TRIGGER prospecting_runs_append_only
  BEFORE UPDATE OR DELETE ON public.prospecting_runs
  FOR EACH ROW EXECUTE FUNCTION public.prospecting_append_only_guard();
DROP TRIGGER IF EXISTS prospecting_reasons_append_only ON public.prospecting_run_rejection_reasons;
CREATE TRIGGER prospecting_reasons_append_only
  BEFORE UPDATE OR DELETE ON public.prospecting_run_rejection_reasons
  FOR EACH ROW EXECUTE FUNCTION public.prospecting_append_only_guard();
DROP TRIGGER IF EXISTS prospecting_transitions_append_only ON public.prospecting_city_transitions;
CREATE TRIGGER prospecting_transitions_append_only
  BEFORE UPDATE OR DELETE ON public.prospecting_city_transitions
  FOR EACH ROW EXECUTE FUNCTION public.prospecting_append_only_guard();

ALTER TABLE public.prospecting_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospecting_run_rejection_reasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospecting_city_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospecting_city_transitions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.prospecting_runs, public.prospecting_run_rejection_reasons,
  public.prospecting_city_state, public.prospecting_city_transitions FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prospecting_validate_transition() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prospecting_city_state_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prospecting_append_only_guard() FROM PUBLIC;

DO $$
DECLARE role_name name;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon'::name, 'authenticated'::name] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.prospecting_runs, public.prospecting_run_rejection_reasons, public.prospecting_city_state, public.prospecting_city_transitions FROM %I', role_name);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT SELECT, INSERT ON TABLE public.prospecting_runs, public.prospecting_run_rejection_reasons, public.prospecting_city_transitions TO service_role';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON TABLE public.prospecting_city_state TO service_role';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lead_finder_api_runtime') THEN
    EXECUTE 'GRANT SELECT, INSERT ON TABLE public.prospecting_runs, public.prospecting_run_rejection_reasons, public.prospecting_city_transitions TO lead_finder_api_runtime';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON TABLE public.prospecting_city_state TO lead_finder_api_runtime';
    EXECUTE 'DROP POLICY IF EXISTS prospecting_runs_runtime_policy ON public.prospecting_runs';
    EXECUTE 'DROP POLICY IF EXISTS prospecting_reasons_runtime_policy ON public.prospecting_run_rejection_reasons';
    EXECUTE 'DROP POLICY IF EXISTS prospecting_state_runtime_policy ON public.prospecting_city_state';
    EXECUTE 'DROP POLICY IF EXISTS prospecting_transitions_runtime_policy ON public.prospecting_city_transitions';
    EXECUTE 'CREATE POLICY prospecting_runs_runtime_policy ON public.prospecting_runs FOR ALL TO lead_finder_api_runtime USING (true) WITH CHECK (true)';
    EXECUTE 'CREATE POLICY prospecting_reasons_runtime_policy ON public.prospecting_run_rejection_reasons FOR ALL TO lead_finder_api_runtime USING (true) WITH CHECK (true)';
    EXECUTE 'CREATE POLICY prospecting_state_runtime_policy ON public.prospecting_city_state FOR ALL TO lead_finder_api_runtime USING (true) WITH CHECK (true)';
    EXECUTE 'CREATE POLICY prospecting_transitions_runtime_policy ON public.prospecting_city_transitions FOR ALL TO lead_finder_api_runtime USING (true) WITH CHECK (true)';
  END IF;
END
$$;

COMMIT;
