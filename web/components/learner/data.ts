// Server-only data access for the LEARNER surface. Centralises the seeded
// identity + the read fetches each screen needs, normalising the backend's
// occasionally-wrapped response shapes. Reads only — mutations go through /api/*.
import "server-only";
import { api, tpath } from "@/lib/api";
import { seed } from "@/lib/config";
import { getSession } from "@/lib/auth/session";
import type {
  Concept,
  Dependency,
  Domain,
  LearnerState,
  LLMConfiguration,
  PedagogicalSnapshot,
  ReviewCard,
} from "@/lib/types";

// The active learner is the AUTHENTICATED user (their LORE user id is the learner
// id; the bearer token only authorizes their own routes). Falls back to the seed
// for resilience if called outside a session.
export async function activeLearner(): Promise<{ id: string; name: string }> {
  const session = await getSession();
  if (session?.userId) return { id: session.userId, name: session.name || "Learner" };
  const s = seed();
  return s.learners[0] ?? { id: "learner-1", name: "Amara Okafor" };
}

// Some endpoints return a bare array, some wrap it ({ states: [...] }).
function asArray<T>(data: unknown, key: string): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === "object") {
    const v = (data as Record<string, unknown>)[key];
    if (Array.isArray(v)) return v as T[];
  }
  return [];
}

// A loaded list that stays honest about *why* it might be empty: a reachable
// backend that returned nothing ("empty") vs. one we couldn't reach ("error").
// Screens render distinct states for each — we never fabricate to fill silence.
export type Loaded<T> =
  | { ok: true; data: T[] }
  | { ok: false; error: string };

export async function getStates(learnerId: string): Promise<LearnerState[]> {
  const r = await api.get<unknown>(tpath(`/learners/${learnerId}/state`));
  return r.ok ? asArray<LearnerState>(r.data, "states") : [];
}

export async function loadStates(learnerId: string): Promise<Loaded<LearnerState>> {
  const r = await api.get<unknown>(tpath(`/learners/${learnerId}/state`));
  return r.ok ? { ok: true, data: asArray<LearnerState>(r.data, "states") } : { ok: false, error: r.error };
}

export async function getReviewsDue(learnerId: string): Promise<ReviewCard[]> {
  const r = await api.get<unknown>(tpath(`/learners/${learnerId}/reviews/due`));
  return r.ok ? asArray<ReviewCard>(r.data, "reviews") : [];
}

export async function loadReviewsDue(learnerId: string): Promise<Loaded<ReviewCard>> {
  const r = await api.get<unknown>(tpath(`/learners/${learnerId}/reviews/due`));
  return r.ok ? { ok: true, data: asArray<ReviewCard>(r.data, "reviews") } : { ok: false, error: r.error };
}

export async function getSnapshots(learnerId: string): Promise<PedagogicalSnapshot[]> {
  const r = await api.get<unknown>(tpath(`/learners/${learnerId}/snapshots`));
  return r.ok ? asArray<PedagogicalSnapshot>(r.data, "snapshots") : [];
}

export async function loadSnapshots(learnerId: string): Promise<Loaded<PedagogicalSnapshot>> {
  const r = await api.get<unknown>(tpath(`/learners/${learnerId}/snapshots`));
  return r.ok ? { ok: true, data: asArray<PedagogicalSnapshot>(r.data, "snapshots") } : { ok: false, error: r.error };
}

export interface DomainGraphData {
  domain?: Domain;
  concepts: Concept[];
  dependencies: Dependency[];
}

// The domain endpoint returns { domain, concepts, dependencies } (the graph).
export async function getDomainGraph(domainId: string): Promise<DomainGraphData> {
  const r = await api.get<unknown>(tpath(`/domains/${domainId}`));
  if (!r.ok || !r.data || typeof r.data !== "object") {
    return { concepts: [], dependencies: [] };
  }
  const d = r.data as Record<string, unknown>;
  return {
    domain: (d.domain as Domain) ?? undefined,
    concepts: asArray<Concept>(d.concepts, "concepts"),
    dependencies: asArray<Dependency>(d.dependencies, "dependencies"),
  };
}

export async function loadDomainGraph(
  domainId: string
): Promise<{ ok: true; data: DomainGraphData } | { ok: false; error: string }> {
  const r = await api.get<unknown>(tpath(`/domains/${domainId}`));
  if (!r.ok) return { ok: false, error: r.error };
  if (!r.data || typeof r.data !== "object") return { ok: true, data: { concepts: [], dependencies: [] } };
  const d = r.data as Record<string, unknown>;
  return {
    ok: true,
    data: {
      domain: (d.domain as Domain) ?? undefined,
      concepts: asArray<Concept>(d.concepts, "concepts"),
      dependencies: asArray<Dependency>(d.dependencies, "dependencies"),
    },
  };
}

export async function getLlmConfig(): Promise<LLMConfiguration | null> {
  const r = await api.get<LLMConfiguration>(tpath(`/llm-configurations`));
  return r.ok ? r.data : null;
}

// The concept the runtime is currently driving the learner on. Honest selection:
// prefer the concept whose review is most overdue / lowest retention, falling back
// to the first tracked concept. No invented ordering beyond the live signals.
export function focusState(states: LearnerState[]): LearnerState | undefined {
  if (states.length === 0) return undefined;
  const overdue = states
    .filter((s) => s.due_at)
    .sort((a, b) => new Date(a.due_at as string).getTime() - new Date(b.due_at as string).getTime());
  if (overdue.length) return overdue[0];
  return [...states].sort((a, b) => a.retention - b.retention)[0];
}

export function conceptName(concepts: Concept[], id?: string | null): string {
  if (!id) return "—";
  return concepts.find((c) => c.id === id)?.name ?? id;
}
