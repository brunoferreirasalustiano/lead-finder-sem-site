-- Read-only capability check. A missing object/privilege fails before enqueue.
SELECT current_user = 'lead_finder_discovery_runtime'
  AND has_schema_privilege(current_user, 'lead_finder_internal', 'USAGE')
  AND has_function_privilege(current_user,
    'lead_finder_internal.sync_daily6_batch_from_collection(text)', 'EXECUTE')
  AND NOT EXISTS (
    SELECT 1 FROM (VALUES
      ('collection_jobs','status'), ('collection_jobs','error'),
      ('collection_jobs','lease_token'), ('collection_jobs','lease_expires_at'),
      ('collection_jobs','attempt_count'), ('collection_jobs','updated_at'),
      ('leads','city'), ('leads','state'), ('leads','status'),
      ('leads','website_status'), ('leads','updated_at'),
      ('lead_contacts','original_value'), ('lead_contacts','source'),
      ('lead_contacts','confidence'), ('lead_contacts','verified_at'),
      ('lead_contacts','is_valid'), ('lead_contacts','updated_at')
    ) AS required(table_name, column_name)
    WHERE NOT has_column_privilege(current_user,
      'public.' || required.table_name, required.column_name, 'UPDATE')
  )
  AND NOT EXISTS (
    SELECT 1 FROM (VALUES ('collection_jobs'), ('leads'), ('lead_contacts'), ('lead_evidence')) AS required(table_name)
    WHERE NOT has_table_privilege(current_user, 'public.' || required.table_name, 'SELECT')
      OR NOT has_table_privilege(current_user, 'public.' || required.table_name, 'INSERT')
  ) AS capabilities_ready;
