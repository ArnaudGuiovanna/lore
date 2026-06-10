-- B-10: contractual documents of the organisme de formation. The body is
-- authored text (markdown); the web tier renders PDFs by merging the tenant's
-- legal profile. Versions are append-only: a new version references root_id.
CREATE TABLE IF NOT EXISTS of_documents (
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    id TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    root_id TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
    kind TEXT NOT NULL CHECK (kind IN ('CONVENTION', 'CONTRAT', 'DEVIS', 'PROGRAMME', 'REGLEMENT_INTERIEUR', 'AUTRE')),
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    cohort_id TEXT,
    learner_id TEXT,
    created_by TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at TIMESTAMPTZ,
    PRIMARY KEY (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS of_documents_root_idx ON of_documents (tenant_id, root_id, version DESC);
CREATE INDEX IF NOT EXISTS of_documents_kind_idx ON of_documents (tenant_id, kind) WHERE archived_at IS NULL;

DO $$
DECLARE
    table_name TEXT;
BEGIN
    FOREACH table_name IN ARRAY ARRAY['of_documents']
    LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
        EXECUTE format(
            'CREATE POLICY tenant_isolation_%I ON %I USING (tenant_id::text = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id::text = current_setting(''app.tenant_id'', true))',
            table_name, table_name
        );
    END LOOP;
END $$;
