-- B-20: abonnements webhook signés. Chaque livraison porte une signature
-- HMAC-SHA256 du corps (header X-LORE-Signature: sha256=<hex>) calculée avec
-- le secret de l'abonnement — le récepteur vérifie l'authenticité.
CREATE TABLE IF NOT EXISTS webhook_subscriptions (
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    id TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    url TEXT NOT NULL,
    secret TEXT NOT NULL,
    event_types JSONB NOT NULL DEFAULT '[]'::jsonb,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at TIMESTAMPTZ,
    PRIMARY KEY (tenant_id, id)
);

DO $$
DECLARE
    table_name TEXT;
BEGIN
    FOREACH table_name IN ARRAY ARRAY['webhook_subscriptions']
    LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
        EXECUTE format(
            'CREATE POLICY tenant_isolation_%I ON %I USING (tenant_id::text = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id::text = current_setting(''app.tenant_id'', true))',
            table_name, table_name
        );
    END LOOP;
END $$;
