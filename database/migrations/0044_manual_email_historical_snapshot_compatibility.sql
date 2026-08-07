BEGIN;

ALTER TABLE public.pilot_manual_message_preparations
  DROP CONSTRAINT IF EXISTS pilot_manual_message_preparations_result_snapshot_check;

ALTER TABLE public.pilot_manual_message_preparations
  ADD CONSTRAINT pilot_manual_message_preparations_result_snapshot_check
  CHECK (
    jsonb_typeof(result_snapshot) = 'object'
    AND result_snapshot ?& ARRAY[
      'channel',
      'templateId',
      'templateVersion',
      'variables',
      'contactFingerprint',
      'messageFingerprint'
    ]
    AND NOT (result_snapshot ?| ARRAY['message','subject','link','url','contactValue'])
    AND result_snapshot->>'channel' = channel
    AND result_snapshot->>'templateId' = template_id
    AND result_snapshot->>'templateVersion' = template_version
    AND jsonb_typeof(result_snapshot->'variables') = 'object'
    AND coalesce(result_snapshot->>'contactFingerprint','') ~ '^[0-9a-f]{64}$'
    AND coalesce(result_snapshot->>'messageFingerprint','') ~ '^[0-9a-f]{64}$'
    AND (
      (
        template_version = 'v1'
        AND (
          result_snapshot - ARRAY[
            'schemaVersion',
            'channel',
            'templateId',
            'templateVersion',
            'variables',
            'renderedInputsFingerprint',
            'contactFingerprint',
            'messageFingerprint'
          ]::text[]
        ) = '{}'::jsonb
        AND (
          NOT (result_snapshot ? 'schemaVersion')
          OR result_snapshot->'schemaVersion' = '2'::jsonb
        )
        AND (
          NOT (result_snapshot ? 'renderedInputsFingerprint')
          OR coalesce(result_snapshot->>'renderedInputsFingerprint','') ~ '^[0-9a-f]{64}$'
        )
      )
      OR
      (
        template_version = 'v2'
        AND result_snapshot ?& ARRAY[
          'schemaVersion',
          'channel',
          'templateId',
          'templateVersion',
          'variables',
          'renderedInputsFingerprint',
          'contactFingerprint',
          'messageFingerprint'
        ]
        AND (
          result_snapshot - ARRAY[
            'schemaVersion',
            'channel',
            'templateId',
            'templateVersion',
            'variables',
            'renderedInputsFingerprint',
            'contactFingerprint',
            'messageFingerprint'
          ]::text[]
        ) = '{}'::jsonb
        AND result_snapshot->'schemaVersion' = '2'::jsonb
        AND result_snapshot->'variables' = '{}'::jsonb
        AND coalesce(result_snapshot->>'renderedInputsFingerprint','') ~ '^[0-9a-f]{64}$'
      )
    )
  );

COMMIT;
