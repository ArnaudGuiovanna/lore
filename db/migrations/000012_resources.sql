-- B-17: ressources pédagogiques — fichiers (stockés en base, volumes OF
-- modestes) ou liens externes, distribués au tenant entier ou à une cohorte.
CREATE TABLE IF NOT EXISTS resources (
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    id TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    cohort_id TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL CHECK (kind IN ('FICHIER', 'LIEN')),
    url TEXT NOT NULL DEFAULT '',
    file_name TEXT NOT NULL DEFAULT '',
    mime_type TEXT NOT NULL DEFAULT '',
    size_bytes BIGINT NOT NULL DEFAULT 0,
    content BYTEA,
    uploaded_by TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at TIMESTAMPTZ,
    PRIMARY KEY (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS resources_cohort_idx ON resources (tenant_id, cohort_id, created_at DESC);

DO $$
DECLARE
    table_name TEXT;
BEGIN
    FOREACH table_name IN ARRAY ARRAY['resources']
    LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
        EXECUTE format(
            'CREATE POLICY tenant_isolation_%I ON %I USING (tenant_id::text = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id::text = current_setting(''app.tenant_id'', true))',
            table_name, table_name
        );
    END LOOP;
END $$;
