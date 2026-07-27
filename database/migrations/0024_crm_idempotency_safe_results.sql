CREATE OR REPLACE FUNCTION public.pii_safe_crm_idempotency_result(
  p_resource_type text,
  p_resource_id uuid,
  p_result jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_resource_type = 'lead' THEN
    RETURN jsonb_strip_nulls(jsonb_build_object(
      'schemaVersion', 1,
      'resourceType', 'lead',
      'id', COALESCE(p_result -> 'id', to_jsonb(p_resource_id)),
      'qualificationStatus', COALESCE(p_result -> 'qualificationStatus', p_result -> 'qualification_status'),
      'isBlocked', COALESCE(p_result -> 'isBlocked', p_result -> 'is_blocked'),
      'doNotContact', COALESCE(p_result -> 'doNotContact', p_result -> 'do_not_contact'),
      'crmStage', COALESCE(p_result -> 'crmStage', p_result -> 'crm_stage'),
      'crmPriority', COALESCE(p_result -> 'crmPriority', p_result -> 'crm_priority'),
      'crmNextActionAt', COALESCE(p_result -> 'crmNextActionAt', p_result -> 'crm_next_action_at'),
      'crmVersion', COALESCE(p_result -> 'crmVersion', p_result -> 'crm_version'),
      'crmUpdatedAt', COALESCE(p_result -> 'crmUpdatedAt', p_result -> 'crm_updated_at'),
      'createdAt', COALESCE(p_result -> 'createdAt', p_result -> 'created_at'),
      'updatedAt', COALESCE(p_result -> 'updatedAt', p_result -> 'updated_at')
    ));
  END IF;

  IF p_resource_type = 'opportunity' THEN
    RETURN jsonb_strip_nulls(jsonb_build_object(
      'schemaVersion', 1,
      'resourceType', 'opportunity',
      'id', COALESCE(p_result -> 'id', to_jsonb(p_resource_id)),
      'leadId', COALESCE(p_result -> 'leadId', p_result -> 'lead_id'),
      'amount', p_result -> 'amount',
      'currency', p_result -> 'currency',
      'expectedCloseAt', COALESCE(p_result -> 'expectedCloseAt', p_result -> 'expected_close_at'),
      'closedAt', COALESCE(p_result -> 'closedAt', p_result -> 'closed_at'),
      'outcome', p_result -> 'outcome',
      'version', p_result -> 'version',
      'createdAt', COALESCE(p_result -> 'createdAt', p_result -> 'created_at'),
      'updatedAt', COALESCE(p_result -> 'updatedAt', p_result -> 'updated_at')
    ));
  END IF;

  IF p_resource_type = 'note' THEN
    RETURN jsonb_strip_nulls(jsonb_build_object(
      'schemaVersion', 1,
      'resourceType', 'note',
      'id', COALESCE(p_result -> 'id', to_jsonb(p_resource_id)),
      'leadId', COALESCE(p_result -> 'leadId', p_result -> 'lead_id'),
      'opportunityId', COALESCE(p_result -> 'opportunityId', p_result -> 'opportunity_id'),
      'createdAt', COALESCE(p_result -> 'createdAt', p_result -> 'created_at')
    ));
  END IF;

  IF p_resource_type = 'tag' THEN
    IF COALESCE((p_result ->> 'removed')::boolean, false) THEN
      RETURN jsonb_strip_nulls(jsonb_build_object(
        'schemaVersion', 1,
        'resourceType', 'tag',
        'removed', true,
        'tagId', COALESCE(p_result -> 'tagId', p_result -> 'id', to_jsonb(p_resource_id)),
        'leadId', COALESCE(p_result -> 'leadId', p_result -> 'lead_id')
      ));
    END IF;
    RETURN jsonb_strip_nulls(jsonb_build_object(
      'schemaVersion', 1,
      'resourceType', 'tag',
      'id', COALESCE(p_result -> 'id', p_result -> 'tagId', to_jsonb(p_resource_id)),
      'leadId', COALESCE(p_result -> 'leadId', p_result -> 'lead_id'),
      'createdAt', COALESCE(p_result -> 'createdAt', p_result -> 'created_at')
    ));
  END IF;

  IF p_resource_type = 'task' THEN
    RETURN jsonb_strip_nulls(jsonb_build_object(
      'schemaVersion', 1,
      'resourceType', 'task',
      'id', COALESCE(p_result -> 'id', to_jsonb(p_resource_id)),
      'leadId', COALESCE(p_result -> 'leadId', p_result -> 'lead_id'),
      'opportunityId', COALESCE(p_result -> 'opportunityId', p_result -> 'opportunity_id'),
      'status', p_result -> 'status',
      'priority', p_result -> 'priority',
      'dueAt', COALESCE(p_result -> 'dueAt', p_result -> 'due_at'),
      'completedAt', COALESCE(p_result -> 'completedAt', p_result -> 'completed_at'),
      'version', p_result -> 'version',
      'createdAt', COALESCE(p_result -> 'createdAt', p_result -> 'created_at'),
      'updatedAt', COALESCE(p_result -> 'updatedAt', p_result -> 'updated_at')
    ));
  END IF;

  RETURN jsonb_build_object(
    'schemaVersion', 1,
    'resourceType', p_resource_type,
    'id', p_resource_id
  );
END
$$;

CREATE OR REPLACE FUNCTION public.sanitize_crm_idempotency_result()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  NEW.result := public.pii_safe_crm_idempotency_result(
    NEW.resource_type,
    NEW.resource_id,
    NEW.result
  );
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.pii_safe_crm_idempotency_result(text, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sanitize_crm_idempotency_result() FROM PUBLIC;

ALTER TABLE public.crm_idempotency_keys DISABLE TRIGGER USER;

UPDATE public.crm_idempotency_keys idempotency_record
SET result = public.pii_safe_crm_idempotency_result(
  idempotency_record.resource_type,
  idempotency_record.resource_id,
  idempotency_record.result
)
WHERE result IS DISTINCT FROM public.pii_safe_crm_idempotency_result(
  idempotency_record.resource_type,
  idempotency_record.resource_id,
  idempotency_record.result
);

ALTER TABLE public.crm_idempotency_keys ENABLE TRIGGER USER;

DROP TRIGGER IF EXISTS crm_idempotency_result_pii_guard
  ON public.crm_idempotency_keys;
CREATE TRIGGER crm_idempotency_result_pii_guard
BEFORE INSERT OR UPDATE OF resource_type, resource_id, result
ON public.crm_idempotency_keys
FOR EACH ROW
EXECUTE FUNCTION public.sanitize_crm_idempotency_result();

COMMENT ON FUNCTION public.pii_safe_crm_idempotency_result(text, uuid, jsonb) IS
  'Versioned deterministic CRM replay projection without names, contacts, notes, descriptions or owners.';
