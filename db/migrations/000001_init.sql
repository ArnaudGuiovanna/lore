CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_id UUID REFERENCES tenants(id),
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    role TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, user_id)
);

CREATE TABLE programs (
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    id TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, id)
);

CREATE TABLE cohorts (
    tenant_id UUID NOT NULL,
    id TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    program_id TEXT,
    name TEXT NOT NULL,
    start_date DATE,
    end_date DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, id),
    FOREIGN KEY (tenant_id, program_id) REFERENCES programs(tenant_id, id)
);

CREATE TABLE cohort_enrollments (
    tenant_id UUID NOT NULL,
    cohort_id TEXT NOT NULL,
    learner_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, cohort_id, learner_id),
    FOREIGN KEY (tenant_id, cohort_id) REFERENCES cohorts(tenant_id, id)
);

CREATE TABLE syllabi (
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    id TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    objectives_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    outcomes_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, id)
);

CREATE TABLE syllabus_bindings (
    tenant_id UUID NOT NULL,
    id TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    syllabus_id TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    adaptation_mode TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, id),
    FOREIGN KEY (tenant_id, syllabus_id) REFERENCES syllabi(tenant_id, id)
);

CREATE TABLE domains (
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    id TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    owner_id TEXT,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL,
    graph_version INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    phase TEXT NOT NULL DEFAULT 'INSTRUCTION',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, id)
);

CREATE TABLE concepts (
    tenant_id UUID NOT NULL,
    id TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    domain_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    difficulty DOUBLE PRECISION NOT NULL DEFAULT 0.5 CHECK (difficulty >= 0 AND difficulty <= 1),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, id),
    FOREIGN KEY (tenant_id, domain_id) REFERENCES domains(tenant_id, id)
);

CREATE TABLE concept_dependencies (
    tenant_id UUID NOT NULL,
    domain_id TEXT NOT NULL,
    parent_concept_id TEXT NOT NULL,
    child_concept_id TEXT NOT NULL,
    PRIMARY KEY (tenant_id, domain_id, parent_concept_id, child_concept_id),
    FOREIGN KEY (tenant_id, domain_id) REFERENCES domains(tenant_id, id),
    FOREIGN KEY (tenant_id, parent_concept_id) REFERENCES concepts(tenant_id, id),
    FOREIGN KEY (tenant_id, child_concept_id) REFERENCES concepts(tenant_id, id),
    CHECK (parent_concept_id <> child_concept_id)
);

CREATE TABLE learner_states (
    tenant_id UUID NOT NULL,
    learner_id TEXT NOT NULL,
    domain_id TEXT NOT NULL,
    concept_id TEXT NOT NULL,
    mastery DOUBLE PRECISION NOT NULL CHECK (mastery >= 0 AND mastery <= 1),
    retention DOUBLE PRECISION NOT NULL CHECK (retention >= 0 AND retention <= 1),
    confidence DOUBLE PRECISION NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    ability DOUBLE PRECISION NOT NULL DEFAULT 0,
    p_learn DOUBLE PRECISION NOT NULL DEFAULT 0.18 CHECK (p_learn >= 0 AND p_learn <= 1),
    p_forget DOUBLE PRECISION NOT NULL DEFAULT 0.02 CHECK (p_forget >= 0 AND p_forget <= 1),
    p_slip DOUBLE PRECISION NOT NULL DEFAULT 0.10 CHECK (p_slip >= 0 AND p_slip <= 0.5),
    p_guess DOUBLE PRECISION NOT NULL DEFAULT 0.20 CHECK (p_guess >= 0 AND p_guess <= 0.5),
    stability DOUBLE PRECISION NOT NULL DEFAULT 0,
    difficulty DOUBLE PRECISION NOT NULL DEFAULT 5,
    reps INTEGER NOT NULL DEFAULT 0,
    lapses INTEGER NOT NULL DEFAULT 0,
    card_state TEXT NOT NULL DEFAULT 'new',
    due_at TIMESTAMPTZ,
    last_interaction_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, learner_id, concept_id),
    FOREIGN KEY (tenant_id, domain_id) REFERENCES domains(tenant_id, id),
    FOREIGN KEY (tenant_id, concept_id) REFERENCES concepts(tenant_id, id)
);

CREATE TABLE review_cards (
    tenant_id UUID NOT NULL,
    learner_id TEXT NOT NULL,
    domain_id TEXT NOT NULL,
    concept_id TEXT NOT NULL,
    due_at TIMESTAMPTZ NOT NULL,
    stability DOUBLE PRECISION NOT NULL DEFAULT 0,
    difficulty DOUBLE PRECISION NOT NULL DEFAULT 5,
    reps INTEGER NOT NULL DEFAULT 0,
    lapses INTEGER NOT NULL DEFAULT 0,
    state TEXT NOT NULL DEFAULT 'new',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, learner_id, concept_id),
    FOREIGN KEY (tenant_id, domain_id) REFERENCES domains(tenant_id, id),
    FOREIGN KEY (tenant_id, concept_id) REFERENCES concepts(tenant_id, id)
);

CREATE TABLE activities (
    tenant_id UUID NOT NULL,
    id TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    learner_id TEXT NOT NULL,
    domain_id TEXT NOT NULL,
    concept_id TEXT NOT NULL,
    activity_type TEXT NOT NULL,
    difficulty DOUBLE PRECISION NOT NULL CHECK (difficulty >= 0 AND difficulty <= 1),
    status TEXT NOT NULL,
    instruction_id TEXT,
    audit_rationale TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    PRIMARY KEY (tenant_id, id),
    FOREIGN KEY (tenant_id, domain_id) REFERENCES domains(tenant_id, id),
    FOREIGN KEY (tenant_id, concept_id) REFERENCES concepts(tenant_id, id)
);

CREATE TABLE tutor_instructions (
    tenant_id UUID NOT NULL,
    id TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    activity_id TEXT NOT NULL,
    learner_id TEXT NOT NULL,
    domain_id TEXT NOT NULL,
    concept_id TEXT,
    activity_type TEXT NOT NULL,
    difficulty DOUBLE PRECISION NOT NULL CHECK (difficulty >= 0 AND difficulty <= 1),
    constraints_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    allowed_variants_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    context_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, id),
    FOREIGN KEY (tenant_id, activity_id) REFERENCES activities(tenant_id, id)
);

CREATE TABLE generated_contents (
    tenant_id UUID NOT NULL,
    id TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    instruction_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, id),
    FOREIGN KEY (tenant_id, instruction_id) REFERENCES tutor_instructions(tenant_id, id)
);

CREATE TABLE llm_configurations (
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    provider TEXT NOT NULL DEFAULT 'instruction_only',
    model TEXT NOT NULL DEFAULT 'runtime',
    base_url TEXT NOT NULL DEFAULT '',
    api_key TEXT NOT NULL DEFAULT '',
    temperature DOUBLE PRECISION NOT NULL DEFAULT 0,
    max_tokens INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id)
);

CREATE TABLE interactions (
    tenant_id UUID NOT NULL,
    id TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    learner_id TEXT NOT NULL,
    activity_id TEXT NOT NULL,
    domain_id TEXT NOT NULL,
    concept_id TEXT NOT NULL,
    success BOOLEAN NOT NULL,
    score DOUBLE PRECISION NOT NULL CHECK (score >= 0 AND score <= 1),
    error_type TEXT,
    payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, id),
    FOREIGN KEY (tenant_id, activity_id) REFERENCES activities(tenant_id, id)
);

CREATE TABLE evaluations (
    tenant_id UUID NOT NULL,
    id TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    interaction_id TEXT NOT NULL,
    score DOUBLE PRECISION NOT NULL CHECK (score >= 0 AND score <= 1),
    feedback TEXT NOT NULL DEFAULT '',
    rubric_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, id),
    FOREIGN KEY (tenant_id, interaction_id) REFERENCES interactions(tenant_id, id)
);

CREATE TABLE misconceptions (
    tenant_id UUID NOT NULL,
    id TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    learner_id TEXT NOT NULL,
    concept_id TEXT NOT NULL,
    description TEXT NOT NULL,
    severity DOUBLE PRECISION NOT NULL CHECK (severity >= 0 AND severity <= 1),
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, id),
    FOREIGN KEY (tenant_id, concept_id) REFERENCES concepts(tenant_id, id)
);

CREATE TABLE pedagogical_snapshots (
    tenant_id UUID NOT NULL,
    id TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    interaction_id TEXT,
    activity_id TEXT,
    learner_id TEXT NOT NULL,
    domain_id TEXT NOT NULL,
    concept_id TEXT,
    before_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    observation_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    after_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    decision_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, id)
);

CREATE TABLE alerts (
    tenant_id UUID NOT NULL,
    id TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    dedupe_key TEXT NOT NULL,
    learner_id TEXT NOT NULL,
    concept_id TEXT,
    alert_type TEXT NOT NULL,
    severity TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'OPEN',
    payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    recommended_action TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, id),
    UNIQUE (tenant_id, dedupe_key)
);

CREATE TABLE event_outbox (
    tenant_id UUID NOT NULL,
    id TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    schema_version INTEGER NOT NULL DEFAULT 1,
    actor_user_id TEXT NOT NULL DEFAULT '',
    correlation_id TEXT NOT NULL DEFAULT '',
    causation_id TEXT NOT NULL DEFAULT '',
    event_type TEXT NOT NULL,
    aggregate_type TEXT NOT NULL,
    aggregate_id TEXT NOT NULL,
    payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_at TIMESTAMPTZ,
    PRIMARY KEY (tenant_id, id)
);

CREATE TABLE idempotency_records (
    tenant_id UUID NOT NULL,
    key TEXT NOT NULL,
    status_code INTEGER NOT NULL DEFAULT 200,
    response_json JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, key)
);

DO $$
DECLARE
    table_name TEXT;
BEGIN
    FOREACH table_name IN ARRAY ARRAY[
        'memberships', 'programs', 'cohorts', 'cohort_enrollments',
        'syllabi', 'syllabus_bindings', 'domains', 'concepts',
        'concept_dependencies', 'learner_states', 'review_cards',
        'activities', 'tutor_instructions', 'generated_contents',
        'llm_configurations',
        'interactions', 'evaluations', 'misconceptions',
        'pedagogical_snapshots', 'alerts', 'event_outbox',
        'idempotency_records'
    ]
    LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
        EXECUTE format(
            'CREATE POLICY tenant_isolation_%I ON %I USING (tenant_id::text = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id::text = current_setting(''app.tenant_id'', true))',
            table_name, table_name
        );
    END LOOP;
END $$;
