ALTER TABLE campaign_templates
  ADD CONSTRAINT campaign_templates_campaign_version_id_fkey
  FOREIGN KEY (campaign_version_id)
  REFERENCES campaign_versions(id)
  ON DELETE RESTRICT;
