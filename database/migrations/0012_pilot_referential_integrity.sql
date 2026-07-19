-- Prevent concurrent writes while historical rows are audited and the foreign keys are installed.
LOCK TABLE lead_contacts, pilot_leads, pilot_manual_contacts, pilot_timeline_events
  IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pilot_manual_contacts pmc
    JOIN lead_contacts lc ON lc.id = pmc.contact_id
    WHERE lc.lead_id <> pmc.lead_id
  ) THEN
    RAISE EXCEPTION 'pilot integrity audit failed: manual contact belongs to a different lead'
      USING ERRCODE = '23514', CONSTRAINT = 'pilot_manual_contacts_contact_lead_audit';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pilot_manual_contacts pmc
    WHERE NOT EXISTS (
      SELECT 1 FROM pilot_leads pl
      WHERE pl.pilot_run_id = pmc.pilot_run_id AND pl.lead_id = pmc.lead_id
    )
  ) THEN
    RAISE EXCEPTION 'pilot integrity audit failed: manual contact lead does not belong to pilot run'
      USING ERRCODE = '23514', CONSTRAINT = 'pilot_manual_contacts_pilot_lead_audit';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pilot_timeline_events pte
    WHERE pte.lead_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM pilot_leads pl
        WHERE pl.pilot_run_id = pte.pilot_run_id AND pl.lead_id = pte.lead_id
      )
  ) THEN
    RAISE EXCEPTION 'pilot integrity audit failed: timeline lead does not belong to pilot run'
      USING ERRCODE = '23514', CONSTRAINT = 'pilot_timeline_events_pilot_lead_audit';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS lead_contacts_id_lead_id_uidx
  ON lead_contacts(id, lead_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'pilot_manual_contacts'::regclass
      AND conname = 'pilot_manual_contacts_contact_lead_fk'
  ) THEN
    ALTER TABLE pilot_manual_contacts
      ADD CONSTRAINT pilot_manual_contacts_contact_lead_fk
      FOREIGN KEY (contact_id, lead_id)
      REFERENCES lead_contacts(id, lead_id)
      ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'pilot_timeline_events'::regclass
      AND conname = 'pilot_timeline_events_pilot_lead_fk'
  ) THEN
    ALTER TABLE pilot_timeline_events
      ADD CONSTRAINT pilot_timeline_events_pilot_lead_fk
      FOREIGN KEY (pilot_run_id, lead_id)
      REFERENCES pilot_leads(pilot_run_id, lead_id)
      ON DELETE RESTRICT;
  END IF;
END $$;
