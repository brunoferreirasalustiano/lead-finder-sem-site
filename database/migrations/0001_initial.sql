CREATE TYPE lead_status AS ENUM ('SEM_SITE_CADASTRADO','PROVAVELMENTE_SEM_SITE','POSSUI_SITE','PENDENTE_VALIDACAO','INVALIDO');
CREATE TABLE leads (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),osm_type text NOT NULL,osm_id text NOT NULL,name text,category text NOT NULL,phone text,whatsapp text,email text,website text,instagram text,facebook text,address text,city text,state text,latitude numeric(10,7),longitude numeric(10,7),score integer NOT NULL CHECK (score BETWEEN 0 AND 100),status lead_status NOT NULL,is_closed boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX leads_osm_identity_uidx ON leads(osm_type,osm_id);
CREATE INDEX leads_filter_idx ON leads(status,category,city,score);
CREATE TABLE collection_jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),payload jsonb NOT NULL,status text NOT NULL DEFAULT 'PENDING',error text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX collection_jobs_status_created_idx ON collection_jobs(status,created_at);
