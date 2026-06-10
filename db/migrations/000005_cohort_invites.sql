-- B-23: self-enrollment invite codes. The code itself is the bearer secret
-- (128-bit random, hashed nowhere because it must be shareable as a link).
-- NOTE: this table deliberately has NO row-level security: the public landing
-- page must resolve a code BEFORE any tenant context exists. Rows carry no
-- personal data — only tenant/cohort identifiers and counters — and every
-- read path requires knowing the unguessable code.
CREATE TABLE IF NOT EXISTS cohort_invites (
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    id TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    cohort_id TEXT NOT NULL,
    code TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ,
    max_uses INTEGER NOT NULL DEFAULT 0 CHECK (max_uses >= 0),
    use_count INTEGER NOT NULL DEFAULT 0 CHECK (use_count >= 0),
    created_by TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at TIMESTAMPTZ,
    PRIMARY KEY (tenant_id, id),
    FOREIGN KEY (tenant_id, cohort_id) REFERENCES cohorts(tenant_id, id)
);

CREATE INDEX IF NOT EXISTS cohort_invites_code_idx ON cohort_invites (code);
