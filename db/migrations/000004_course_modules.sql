-- B-24: editorial course modules layered on top of the adaptive runtime.
-- A module groups domain concepts under a syllabus with an explicit order and
-- prerequisites; unlocking is evidence-based (runtime mastery), never declared.
CREATE TABLE IF NOT EXISTS course_modules (
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    id TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    syllabus_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    position INTEGER NOT NULL CHECK (position >= 0),
    concept_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    prerequisite_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    required_mastery DOUBLE PRECISION NOT NULL DEFAULT 0.85 CHECK (required_mastery > 0 AND required_mastery <= 1),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at TIMESTAMPTZ,
    PRIMARY KEY (tenant_id, id),
    FOREIGN KEY (tenant_id, syllabus_id) REFERENCES syllabi(tenant_id, id)
);

CREATE INDEX IF NOT EXISTS course_modules_tenant_syllabus_pos_idx
    ON course_modules (tenant_id, syllabus_id, position);

DO $$
DECLARE
    table_name TEXT;
BEGIN
    FOREACH table_name IN ARRAY ARRAY['course_modules']
    LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
        EXECUTE format(
            'CREATE POLICY tenant_isolation_%I ON %I USING (tenant_id::text = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id::text = current_setting(''app.tenant_id'', true))',
            table_name, table_name
        );
    END LOOP;
END $$;
