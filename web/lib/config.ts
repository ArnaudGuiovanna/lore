// Central runtime config for the LORE frontend.
// Reads the seeded tenant/cohort/domain ids from web/.gen/seed.json (written by scripts/seed.sh),
// falling back to env vars. Server-only.
import { readFileSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { join, dirname } from "node:path";

import type { Role } from "./types";

export type SeedLearner = { id: string; name: string };
export type SeedUser = { id: string; email: string; name: string; role: Role };
export type Seed = {
  base: string;
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  programId: string;
  cohortId: string;
  cohortName: string;
  domainId: string;
  syllabusId: string;
  users: SeedUser[];
  learners: SeedLearner[];
};

let cached: Seed | null = null;

export function seed(): Seed {
  if (cached) return cached;
  const base = process.env.LORE_BASE || "http://127.0.0.1:8080";
  let fromFile: Partial<Seed> = {};
  try {
    fromFile = JSON.parse(readFileSync(join(process.cwd(), ".gen", "seed.json"), "utf8"));
  } catch {
    // no seed file yet — fall back to env / empty (UI degrades gracefully)
  }
  cached = {
    base,
    tenantId: process.env.LORE_TENANT_ID || fromFile.tenantId || "",
    tenantSlug: fromFile.tenantSlug || "acme",
    tenantName: fromFile.tenantName || "Acme Learning",
    programId: fromFile.programId || "",
    cohortId: fromFile.cohortId || "",
    cohortName: fromFile.cohortName || "Go-Spring-24",
    domainId: fromFile.domainId || "",
    syllabusId: fromFile.syllabusId || "",
    users: fromFile.users || [],
    learners: fromFile.learners || [
      { id: "learner-1", name: "Amara Okafor" },
      { id: "learner-2", name: "Diego Santos" },
      { id: "learner-3", name: "Liam Chen" },
      { id: "learner-4", name: "Noor Haddad" },
    ],
  };
  return cached;
}

export const BACKEND_BASE = process.env.LORE_BASE || "http://127.0.0.1:8080";

const SEED_FILE = join(process.cwd(), ".gen", "seed.json");

// Merge a partial config (the new tenant identity, written by the first-run setup
// wizard) into .gen/seed.json so seed()/lib/config picks it up on the next read.
// The file may hold a bootstrap token-adjacent surface (tenant ids), so we keep it
// owner-only. Resets the in-process cache so the running server reflects the change
// without a restart. Server-only callers (the setup route).
export function writeConfig(patch: { tenantId?: string; tenantSlug?: string; tenantName?: string }): void {
  let current: Partial<Seed> = {};
  try {
    current = JSON.parse(readFileSync(SEED_FILE, "utf8"));
  } catch {
    // no existing seed file — start from an empty object
  }
  const merged: Partial<Seed> = { ...current };
  if (patch.tenantId !== undefined) merged.tenantId = patch.tenantId;
  if (patch.tenantSlug !== undefined) merged.tenantSlug = patch.tenantSlug;
  if (patch.tenantName !== undefined) merged.tenantName = patch.tenantName;

  mkdirSync(dirname(SEED_FILE), { recursive: true, mode: 0o700 });
  try { chmodSync(dirname(SEED_FILE), 0o700); } catch { /* best-effort (non-POSIX FS) */ }
  writeFileSync(SEED_FILE, JSON.stringify(merged, null, 2), { mode: 0o600 });
  try { chmodSync(SEED_FILE, 0o600); } catch { /* best-effort */ }

  cached = null; // invalidate so the next seed() reflects the new tenant id
}
