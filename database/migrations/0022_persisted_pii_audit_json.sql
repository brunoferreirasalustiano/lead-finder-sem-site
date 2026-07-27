CREATE OR REPLACE FUNCTION public.pii_safe_qualification_audit_value(
  p_event_type text,
  p_value jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_value IS NULL THEN
    RETURN NULL;
  END IF;

  IF p_event_type IN ('CONTACT_ADDED', 'CONTACT_UPDATED') THEN
    RETURN jsonb_strip_nulls(jsonb_build_object(
      'schemaVersion', 1,
      'contactId', COALESCE(p_value -> 'id', p_value -> 'contactId', p_value -> 'contact_id'),
      'leadId', COALESCE(p_value -> 'leadId', p_value -> 'lead_id'),
      'type', p_value -> 'type',
      'confidence', p_value -> 'confidence',
      'verifiedAt', COALESCE(p_value -> 'verifiedAt', p_value -> 'verified_at'),
      'isValid', COALESCE(p_value -> 'isValid', p_value -> 'is_valid'),
      'possibleWhatsapp', COALESCE(p_value -> 'possibleWhatsapp', p_value -> 'possible_whatsapp'),
      'createdAt', COALESCE(p_value -> 'createdAt', p_value -> 'created_at'),
      'updatedAt', COALESCE(p_value -> 'updatedAt', p_value -> 'updated_at')
    ));
  END IF;

  IF p_event_type = 'EVIDENCE_RECORDED' THEN
    RETURN jsonb_strip_nulls(jsonb_build_object(
      'schemaVersion', 1,
      'evidenceId', COALESCE(p_value -> 'id', p_value -> 'evidenceId'),
      'leadId', COALESCE(p_value -> 'leadId', p_value -> 'lead_id'),
      'confidence', p_value -> 'confidence',
      'observedAt', COALESCE(p_value -> 'observedAt', p_value -> 'observed_at'),
      'fingerprint', p_value -> 'fingerprint',
      'createdAt', COALESCE(p_value -> 'createdAt', p_value -> 'created_at')
    ));
  END IF;

  IF p_event_type = 'QUALIFICATION_CHANGED' THEN
    RETURN jsonb_strip_nulls(jsonb_build_object(
      'schemaVersion', 1,
      'status', COALESCE(p_value -> 'status', p_value -> 'qualificationStatus', p_value -> 'qualification_status'),
      'isBlocked', COALESCE(p_value -> 'isBlocked', p_value -> 'is_blocked'),
      'doNotContact', COALESCE(p_value -> 'doNotContact', p_value -> 'do_not_contact')
    ));
  END IF;

  RETURN jsonb_build_object('schemaVersion', 1);
END
$$;

CREATE OR REPLACE FUNCTION public.pii_safe_crm_audit_value(
  p_event_type text,
  p_value jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_value IS NULL THEN
    RETURN NULL;
  END IF;

  IF p_event_type = 'STAGE_CHANGED' THEN
    RETURN jsonb_strip_nulls(jsonb_build_object(
      'schemaVersion', 1,
      'stage', COALESCE(p_value -> 'stage', p_value -> 'crmStage', p_value -> 'crm_stage'),
      'version', COALESCE(p_value -> 'version', p_value -> 'crmVersion', p_value -> 'crm_version')
    ));
  END IF;

  IF p_event_type = 'ASSIGNMENT_UPDATED' THEN
    RETURN jsonb_strip_nulls(jsonb_build_object(
      'schemaVersion', 1,
      'leadId', p_value -> 'id',
      'priority', COALESCE(p_value -> 'crmPriority', p_value -> 'crm_priority'),
      'nextActionAt', COALESCE(p_value -> 'crmNextActionAt', p_value -> 'crm_next_action_at'),
      'version', COALESCE(p_value -> 'crmVersion', p_value -> 'crm_version'),
      'updatedAt', COALESCE(p_value -> 'updatedAt', p_value -> 'updated_at')
    ));
  END IF;

  IF p_event_type IN ('OPPORTUNITY_CREATED', 'OPPORTUNITY_UPDATED') THEN
    RETURN jsonb_strip_nulls(jsonb_build_object(
      'schemaVersion', 1,
      'opportunityId', p_value -> 'id',
      'leadId', COALESCE(p_value -> 'leadId', p_value -> 'lead_id'),
      'amount', p_value -> 'amount',
      'currency', p_value -> 'currency',
      'expectedCloseAt', COALESCE(p_value -> 'expectedCloseAt', p_value -> 'expected_close_at'),
      'closedAt', COALESCE(p_value -> 'closedAt', p_value -> 'closed_at'),
      'outcome', p_value -> 'outcome',
      'version', p_value -> 'version',
      'createdAt', COALESCE(p_value -> 'createdAt', p_value -> 'created_at'),
      'updatedAt', COALESCE(p_value -> 'updatedAt', p_value -> 'updated_at')
    ));
  END IF;

  IF p_event_type = 'NOTE_ADDED' THEN
    RETURN jsonb_strip_nulls(jsonb_build_object(
      'schemaVersion', 1,
      'noteId', p_value -> 'id',
      'leadId', COALESCE(p_value -> 'leadId', p_value -> 'lead_id'),
      'opportunityId', COALESCE(p_value -> 'opportunityId', p_value -> 'opportunity_id'),
      'createdAt', COALESCE(p_value -> 'createdAt', p_value -> 'created_at')
    ));
  END IF;

  IF p_event_type IN ('TAG_ADDED', 'TAG_REMOVED') THEN
    RETURN jsonb_strip_nulls(jsonb_build_object(
      'schemaVersion', 1,
      'tagId', COALESCE(p_value -> 'tagId', p_value -> 'id', p_value -> 'tag_id'),
      'leadId', COALESCE(p_value -> 'leadId', p_value -> 'lead_id'),
      'removed', p_value -> 'removed',
      'createdAt', COALESCE(p_value -> 'createdAt', p_value -> 'created_at')
    ));
  END IF;

  IF p_event_type IN ('TASK_CREATED', 'TASK_COMPLETED', 'TASK_RESCHEDULED') THEN
    RETURN jsonb_strip_nulls(jsonb_build_object(
      'schemaVersion', 1,
      'taskId', p_value -> 'id',
      'leadId', COALESCE(p_value -> 'leadId', p_value -> 'lead_id'),
      'opportunityId', COALESCE(p_value -> 'opportunityId', p_value -> 'opportunity_id'),
      'status', p_value -> 'status',
      'priority', p_value -> 'priority',
      'dueAt', COALESCE(p_value -> 'dueAt', p_value -> 'due_at'),
      'completedAt', COALESCE(p_value -> 'completedAt', p_value -> 'completed_at'),
      'version', p_value -> 'version',
      'createdAt', COALESCE(p_value -> 'createdAt', p_value -> 'created_at'),
      'updatedAt', COALESCE(p_value -> 'updatedAt', p_value -> 'updated_at')
    ));
  END IF;

  RETURN jsonb_build_object('schemaVersion', 1);
END
$$;

CREATE OR REPLACE FUNCTION public.pii_safe_crm_audit_metadata(p_value jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT CASE
    WHEN p_value IS NULL THEN '{}'::jsonb
    ELSE jsonb_strip_nulls(jsonb_build_object(
      'schemaVersion', 1,
      'action', p_value -> 'action',
      'authenticationMethod', COALESCE(p_value -> 'authenticationMethod', p_value -> 'authentication_method'),
      'requestId', COALESCE(p_value -> 'requestId', p_value -> 'request_id'),
      'source', p_value -> 'source',
      'timestamp', p_value -> 'timestamp'
    ))
  END
$$;

CREATE OR REPLACE FUNCTION public.sanitize_qualification_history_pii()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  NEW.previous_value := public.pii_safe_qualification_audit_value(NEW.event_type, NEW.previous_value);
  NEW.new_value := public.pii_safe_qualification_audit_value(NEW.event_type, NEW.new_value);
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.sanitize_crm_timeline_pii()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  NEW.previous_value := public.pii_safe_crm_audit_value(NEW.event_type, NEW.previous_value);
  NEW.new_value := public.pii_safe_crm_audit_value(NEW.event_type, NEW.new_value);
  NEW.metadata := public.pii_safe_crm_audit_metadata(NEW.metadata);
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.pii_safe_qualification_audit_value(text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pii_safe_crm_audit_value(text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pii_safe_crm_audit_metadata(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sanitize_qualification_history_pii() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sanitize_crm_timeline_pii() FROM PUBLIC;

DROP TRIGGER IF EXISTS lead_qualification_history_pii_guard ON public.lead_qualification_history;
CREATE TRIGGER lead_qualification_history_pii_guard
BEFORE INSERT OR UPDATE OF previous_value, new_value, event_type
ON public.lead_qualification_history
FOR EACH ROW
EXECUTE FUNCTION public.sanitize_qualification_history_pii();

DROP TRIGGER IF EXISTS crm_timeline_events_pii_guard ON public.crm_timeline_events;
CREATE TRIGGER crm_timeline_events_pii_guard
BEFORE INSERT OR UPDATE OF previous_value, new_value, metadata, event_type
ON public.crm_timeline_events
FOR EACH ROW
EXECUTE FUNCTION public.sanitize_crm_timeline_pii();

UPDATE public.lead_qualification_history
SET
  previous_value = public.pii_safe_qualification_audit_value(event_type, previous_value),
  new_value = public.pii_safe_qualification_audit_value(event_type, new_value)
WHERE
  previous_value IS DISTINCT FROM public.pii_safe_qualification_audit_value(event_type, previous_value)
  OR new_value IS DISTINCT FROM public.pii_safe_qualification_audit_value(event_type, new_value);

UPDATE public.crm_timeline_events
SET
  previous_value = public.pii_safe_crm_audit_value(event_type, previous_value),
  new_value = public.pii_safe_crm_audit_value(event_type, new_value),
  metadata = public.pii_safe_crm_audit_metadata(metadata)
WHERE
  previous_value IS DISTINCT FROM public.pii_safe_crm_audit_value(event_type, previous_value)
  OR new_value IS DISTINCT FROM public.pii_safe_crm_audit_value(event_type, new_value)
  OR metadata IS DISTINCT FROM public.pii_safe_crm_audit_metadata(metadata);

COMMENT ON FUNCTION public.pii_safe_qualification_audit_value(text, jsonb) IS
  'Allowlisted audit projection that removes contact values, free text and arbitrary nested JSON.';
COMMENT ON FUNCTION public.pii_safe_crm_audit_value(text, jsonb) IS
  'Allowlisted CRM audit projection that removes names, contact values, notes, descriptions and owners.';
COMMENT ON FUNCTION public.pii_safe_crm_audit_metadata(jsonb) IS
  'Allowlisted CRM metadata projection without principal duplication or arbitrary values.';
