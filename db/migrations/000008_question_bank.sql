-- B-26: trainer question bank + assignments (devoirs) with manual grading.
CREATE TABLE IF NOT EXISTS question_bank (
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    id TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    concept_id TEXT,
    kind TEXT NOT NULL CHECK (kind IN ('single_choice', 'short_answer')),
    prompt TEXT NOT NULL,
    choices JSONB NOT NULL DEFAULT '[]'::jsonb,
    correct_choice_id TEXT NOT NULL DEFAULT '',
    expected_answer TEXT NOT NULL DEFAULT '',
    points DOUBLE PRECISION NOT NULL DEFAULT 1 CHECK (points > 0),
    created_by TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at TIMESTAMPTZ,
    PRIMARY KEY (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS question_bank_concept_idx ON question_bank (tenant_id, concept_id) WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS assignments (
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    id TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    cohort_id TEXT NOT NULL,
    domain_id TEXT NOT NULL DEFAULT '',
    concept_id TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    due_at TIMESTAMPTZ,
    created_by TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at TIMESTAMPTZ,
    PRIMARY KEY (tenant_id, id),
    FOREIGN KEY (tenant_id, cohort_id) REFERENCES cohorts(tenant_id, id)
);
CREATE INDEX IF NOT EXISTS assignments_cohort_idx ON assignments (tenant_id, cohort_id, created_at);

CREATE TABLE IF NOT EXISTS assignment_submissions (
    tenant_id UUID NOT NULL,
    id TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    assignment_id TEXT NOT NULL,
    learner_id TEXT NOT NULL,
    content TEXT NOT NULL,
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    score DOUBLE PRECISION CHECK (score IS NULL OR (score >= 0 AND score <= 1)),
    feedback TEXT NOT NULL DEFAULT '',
    graded_by TEXT NOT NULL DEFAULT '',
    graded_at TIMESTAMPTZ,
    PRIMARY KEY (tenant_id, id),
    UNIQUE (tenant_id, assignment_id, learner_id),
    FOREIGN KEY (tenant_id, assignment_id) REFERENCES assignments(tenant_id, id)
);

DO $$
DECLARE
    table_name TEXT;
BEGIN
    FOREACH table_name IN ARRAY ARRAY['question_bank', 'assignments', 'assignment_submissions']
    LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
        EXECUTE format(
            'CREATE POLICY tenant_isolation_%I ON %I USING (tenant_id::text = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id::text = current_setting(''app.tenant_id'', true))',
            table_name, table_name
        );
    END LOOP;
END $$;
