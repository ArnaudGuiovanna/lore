// B-24 — shared server-side reads for the learner module path. One single
// backend lecture (GET /learners/{l}/path?syllabus_id=…) reused by the
// "Mon parcours" page, the /api/learner/path proxy and the runtime gating in
// /api/activities/next, so the three surfaces can never disagree on the data.
import "server-only";
import { api, tpath } from "@/lib/api";
import { BACKEND_BASE, seed } from "@/lib/config";
import { getSession } from "@/lib/auth/session";
import { explicitSeedFallbackEnabled } from "@/lib/tenant-context";
import type { ModuleProgress, Syllabus } from "@/lib/types";

export type LoadedPath = { ok: true; data: ModuleProgress[] } | { ok: false; error: string };

// GET the evidence-based path of a learner for one syllabus. The bearer token
// of the session is attached by lib/api; a learner token only reads its own path.
export async function loadLearnerPath(learnerId: string, syllabusId: string): Promise<LoadedPath> {
  if (!learnerId || !syllabusId) return { ok: true, data: [] };
  const r = await api.get<ModuleProgress[]>(
    tpath(`/learners/${encodeURIComponent(learnerId)}/path?syllabus_id=${encodeURIComponent(syllabusId)}`)
  );
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, data: Array.isArray(r.data) ? r.data : [] };
}

export interface PrimarySyllabusRef {
  id: string;
  title: string;
}

function pickPrimary(syllabi: Syllabus[]): PrimarySyllabusRef | null {
  if (syllabi.length === 0) return null;
  const seeded = explicitSeedFallbackEnabled() ? seed() : null;
  // Same selection rule as loadTenantContext: the seed-bound syllabus when the
  // explicit demo fallback is on, otherwise the oldest one.
  const sorted = [...syllabi].sort((a, b) => {
    const at = a.created_at ? Date.parse(a.created_at) : 0;
    const bt = b.created_at ? Date.parse(b.created_at) : 0;
    return at - bt || a.id.localeCompare(b.id);
  });
  const chosen = sorted.find((s) => s.id === seeded?.syllabusId) ?? sorted[0];
  return { id: chosen.id, title: chosen.title };
}

// Resolve the tenant's primary syllabus WITHOUT the full tenant-context fan-out
// (cheap enough for the hot /api/activities/next path).
//
// Learner tokens cannot list /syllabi (backend allowlist), so for a learner
// session we fall back to a server-only read with the operator bootstrap token,
// strictly scoped to the session's own tenant. The secret never leaves the
// server and the learner still reads their path with their OWN token. If no
// bootstrap token is configured, we honestly resolve nothing (no gating).
export async function resolvePrimarySyllabus(): Promise<PrimarySyllabusRef | null> {
  const viaSession = await api.get<Syllabus[]>(tpath("/syllabi"));
  if (viaSession.ok && Array.isArray(viaSession.data)) {
    return pickPrimary(viaSession.data);
  }
  const session = await getSession();
  const bootstrap = process.env.LORE_BOOTSTRAP_TOKEN || "";
  if (!session?.tenantId || !bootstrap) return null;
  try {
    const res = await fetch(
      `${BACKEND_BASE}/v1/tenants/${encodeURIComponent(session.tenantId)}/syllabi`,
      { headers: { "X-LORE-Bootstrap-Token": bootstrap }, cache: "no-store" }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as Syllabus[];
    return pickPrimary(Array.isArray(data) ? data : []);
  } catch {
    return null;
  }
}

// Concepts the runtime is allowed to plan in for this learner: the union of the
// concept_ids of every non-LOCKED module of the primary syllabus. Returns null
// when there is NO restriction to apply — no modules authored, no syllabus, or
// a failed path read. Honest contract: a read failure must never lock the
// learner out, so we fall back to the legacy unrestricted planning.
export async function allowedConceptIdsForLearner(learnerId: string): Promise<string[] | null> {
  try {
    const syllabus = await resolvePrimarySyllabus();
    if (!syllabus) return null;
    const path = await loadLearnerPath(learnerId, syllabus.id);
    if (!path.ok || path.data.length === 0) return null;
    const allowed = new Set<string>();
    for (const row of path.data) {
      if (row.status === "LOCKED") continue;
      for (const conceptId of row.module.concept_ids ?? []) allowed.add(conceptId);
    }
    return [...allowed];
  } catch {
    // Defensive: gating is an overlay, never a point of failure for the learner.
    return null;
  }
}
