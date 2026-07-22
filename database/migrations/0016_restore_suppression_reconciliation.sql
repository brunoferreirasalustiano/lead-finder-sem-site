CREATE TABLE IF NOT EXISTS restore_suppression_runs (
  run_id uuid PRIMARY KEY,
  schema_version text NOT NULL CHECK (schema_version = '1.0'),
  manifest_digest char(64) NOT NULL UNIQUE CHECK (manifest_digest ~ '^[0-9a-f]{64}$'),
  logical_origin text NOT NULL CHECK (logical_origin IN ('DATABASE_PRE_RESTORE','EMPTY_DATABASE_BOOTSTRAP')),
  cutoff_at timestamptz NOT NULL,
  state text NOT NULL CHECK (state IN ('RESTORE_SUPPRESSION_SAFE','RESTORE_SUPPRESSION_BLOCKED')),
  total_entries integer NOT NULL CHECK (total_entries >= 0),
  applied_entries integer NOT NULL CHECK (applied_entries >= 0),
  unresolved_entries integer NOT NULL CHECK (unresolved_entries >= 0),
  conflict_entries integer NOT NULL CHECK (conflict_entries >= 0),
  attempt_count bigint NOT NULL CHECK (attempt_count >= 0),
  provider_event_count bigint NOT NULL CHECK (provider_event_count >= 0),
  applied_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz,
  actor text NOT NULL CHECK (actor ~ '^[A-Za-z0-9._:@-]{1,100}$'),
  CHECK ((state = 'RESTORE_SUPPRESSION_SAFE') = (unresolved_entries = 0 AND conflict_entries = 0)),
  CHECK (verified_at IS NULL OR state = 'RESTORE_SUPPRESSION_SAFE')
);

CREATE INDEX IF NOT EXISTS restore_suppression_runs_applied_idx
  ON restore_suppression_runs(applied_at DESC, run_id);

CREATE OR REPLACE FUNCTION protect_restore_suppression_run()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR NEW.run_id IS DISTINCT FROM OLD.run_id
     OR NEW.schema_version IS DISTINCT FROM OLD.schema_version
     OR NEW.manifest_digest IS DISTINCT FROM OLD.manifest_digest
     OR NEW.logical_origin IS DISTINCT FROM OLD.logical_origin
     OR NEW.cutoff_at IS DISTINCT FROM OLD.cutoff_at
     OR NEW.state IS DISTINCT FROM OLD.state
     OR NEW.total_entries IS DISTINCT FROM OLD.total_entries
     OR NEW.applied_entries IS DISTINCT FROM OLD.applied_entries
     OR NEW.unresolved_entries IS DISTINCT FROM OLD.unresolved_entries
     OR NEW.conflict_entries IS DISTINCT FROM OLD.conflict_entries
     OR NEW.attempt_count IS DISTINCT FROM OLD.attempt_count
     OR NEW.provider_event_count IS DISTINCT FROM OLD.provider_event_count
     OR NEW.applied_at IS DISTINCT FROM OLD.applied_at
     OR NEW.actor IS DISTINCT FROM OLD.actor THEN
    RAISE EXCEPTION 'restore suppression evidence is immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD.verified_at IS NOT NULL OR NEW.verified_at IS NULL THEN
    RAISE EXCEPTION 'restore suppression verification is monotonic' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS restore_suppression_runs_protected ON restore_suppression_runs;
CREATE TRIGGER restore_suppression_runs_protected
BEFORE UPDATE OR DELETE ON restore_suppression_runs
FOR EACH ROW EXECUTE FUNCTION protect_restore_suppression_run();
