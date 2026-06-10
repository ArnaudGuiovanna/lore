-- B-11: satisfaction surveys (à chaud / à froid) + complaints register.
-- RNQ indicators require collecting and processing learner appreciation and
-- complaints; both are tenant-scoped evidence with full RLS.
CREATE TABLE IF NOT EXISTS satisfaction_surveys (
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    id TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    cohort_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('HOT', 'COLD')),
    title TEXT NOT NULL,
    questions JSONB NOT NULL DEFAULT '[]'::jsonb,
    opens_at TIMESTAMPTZ,
    closes_at TIMESTAMPTZ,
    created_by TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at TIMESTAMPTZ,
    PRIMARY KEY (tenant_id, id),
    FOREIGN KEY (tenant_id, cohort_id) REFERENCES cohorts(tenant_id, id)
);

CREATE TABLE IF NOT EXISTS satisfaction_responses (
    tenant_id UUID NOT NULL,
    id TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    survey_id TEXT NOT NULL,
    learner_id TEXT NOT NULL,
    answers JSONB NOT NULL DEFAULT '{}'::jsonb,
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, id),
    UNIQUE (tenant_id, survey_id, learner_id),
    FOREIGN KEY (tenant_id, survey_id) REFERENCES satisfaction_surveys(tenant_id, id)
);

CREATE TABLE IF NOT EXISTS complaints (
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    id TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    opened_by TEXT NOT NULL DEFAULT '',
    learner_id TEXT,
    subject TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED')),
    resolution TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    closed_at TIMESTAMPTZ,
    PRIMARY KEY (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS satisfaction_surveys_cohort_idx ON satisfaction_surveys (tenant_id, cohort_id, created_at);
CREATE INDEX IF NOT EXISTS satisfaction_responses_survey_idx ON satisfaction_responses (tenant_id, survey_id);
CREATE INDEX IF NOT EXISTS complaints_status_idx ON complaints (tenant_id, status, created_at);

DO $$
DECLARE
    table_name TEXT;
BEGIN
    FOREACH table_name IN ARRAY ARRAY['satisfaction_surveys', 'satisfaction_responses', 'complaints']
    LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
        EXECUTE format(
            'CREATE POLICY tenant_isolation_%I ON %I USING (tenant_id::text = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id::text = current_setting(''app.tenant_id'', true))',
            table_name, table_name
        );
    END LOOP;
END $$;
