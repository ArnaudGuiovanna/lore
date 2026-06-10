-- B-15: dossiers de financement (CPF/OPCO/France Travail/employeur...) — la
-- donnée administrative minimale pour produire le BPF et suivre les prises en
-- charge. Les connecteurs EDOF/Kairos restent hors périmètre : ce modèle est
-- la source qu'ils synchroniseront.
CREATE TABLE IF NOT EXISTS funding_files (
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    id TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    learner_id TEXT NOT NULL,
    cohort_id TEXT NOT NULL DEFAULT '',
    funder_type TEXT NOT NULL CHECK (funder_type IN ('CPF', 'OPCO', 'FRANCE_TRAVAIL', 'EMPLOYEUR', 'AUTOFINANCEMENT', 'AUTRE')),
    funder_name TEXT NOT NULL DEFAULT '',
    reference TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'EN_INSTRUCTION' CHECK (status IN ('EN_INSTRUCTION', 'ACCEPTE', 'REFUSE', 'SOLDE')),
    amount_cents BIGINT NOT NULL DEFAULT 0,
    notes TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at TIMESTAMPTZ,
    PRIMARY KEY (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS funding_files_learner_idx ON funding_files (tenant_id, learner_id);

-- B-28: textes légaux versionnés (CGU, politique de confidentialité, mentions)
-- et registre des consentements — un consentement référence la version exacte
-- du texte accepté, ce qui le rend opposable.
CREATE TABLE IF NOT EXISTS legal_texts (
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    id TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    kind TEXT NOT NULL CHECK (kind IN ('CGU', 'CONFIDENTIALITE', 'MENTIONS')),
    version INTEGER NOT NULL,
    body TEXT NOT NULL,
    published_by TEXT NOT NULL DEFAULT '',
    published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, id),
    UNIQUE (tenant_id, kind, version)
);

CREATE TABLE IF NOT EXISTS consents (
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    id TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    user_id TEXT NOT NULL,
    legal_text_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    version INTEGER NOT NULL,
    consented_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, id),
    UNIQUE (tenant_id, user_id, legal_text_id)
);
CREATE INDEX IF NOT EXISTS consents_user_idx ON consents (tenant_id, user_id);

DO $$
DECLARE
    table_name TEXT;
BEGIN
    FOREACH table_name IN ARRAY ARRAY['funding_files', 'legal_texts', 'consents']
    LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
        EXECUTE format(
            'CREATE POLICY tenant_isolation_%I ON %I USING (tenant_id::text = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id::text = current_setting(''app.tenant_id'', true))',
            table_name, table_name
        );
    END LOOP;
END $$;
