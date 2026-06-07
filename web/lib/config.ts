// Central runtime config for the LORE frontend.
// Reads the seeded tenant/cohort/domain ids from web/.gen/seed.json (written by scripts/seed.sh),
// falling back to env vars. Server-only.
import { readFileSync } from "node:fs";
import { join } from "node:path";

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
