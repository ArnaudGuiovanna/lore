-- B-09/B-10: legal profile of the training organisation, per tenant.
-- Free-form JSONB (raison sociale, SIRET, NDA, adresse, signataire, …) so the
-- attestation/convention generators read one canonical source.
ALTER TABLE tenants
    ADD COLUMN IF NOT EXISTS profile JSONB NOT NULL DEFAULT '{}'::jsonb;
