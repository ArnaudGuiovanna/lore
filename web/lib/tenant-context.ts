// Server-side tenant context for authenticated web surfaces.
// Backend lists are the source of truth; seed is used only when the operator
// explicitly enables demo/local fallback.
import "server-only";
import { api, tpath } from "@/lib/api";
import { seed } from "@/lib/config";
import { getSession, type Session } from "@/lib/auth/session";
import type { Cohort, CohortEnrollment, Domain, Learner, Program, Syllabus } from "@/lib/types";

type ListKey = "programs" | "cohorts" | "domains" | "learners" | "syllabi" | "enrollments";

export interface TenantContext {
  session: Session | null;
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  programs: Program[];
  cohorts: Cohort[];
  domains: Domain[];
  learners: Learner[];
  syllabi: Syllabus[];
  enrollments: CohortEnrollment[];
  enrollmentsByCohort: Record<string, CohortEnrollment[]>;
  primaryProgram?: Program;
  primaryCohort?: Cohort;
  primaryDomain?: Domain;
  primarySyllabus?: Syllabus;
  errors: Partial<Record<ListKey, string>>;
  usingSeedFallback: boolean;
}

function envFlag(name: string): boolean {
  const v = (process.env[name] || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

export function explicitSeedFallbackEnabled(): boolean {
  return (
    envFlag("LORE_ALLOW_SEED_TENANT_FALLBACK") ||
    envFlag("LORE_DEMO_MODE") ||
    envFlag("LORE_SHOW_DEMO_LOGINS")
  );
}

export async function currentTenantId(): Promise<string> {
  const session = await getSession();
  if (session?.tenantId) return session.tenantId;
  return explicitSeedFallbackEnabled() ? seed().tenantId : "";
}

export async function requireCurrentTenantId(): Promise<string> {
  const tenantId = await currentTenantId();
  if (!tenantId) {
    throw new Error("tenant session required");
  }
  return tenantId;
}

function asArray<T>(data: unknown): T[] {
  return Array.isArray(data) ? (data as T[]) : [];
}

function isoZero(): string {
  return new Date(0).toISOString();
}

function seedLearners(): Learner[] {
  const s = seed();
  return s.learners.map((l) => {
    const u = s.users.find((x) => x.id === l.id);
    return {
      tenant_id: s.tenantId,
      user_id: l.id,
      email: u?.email ?? `${l.id.slice(0, 8)}@${s.tenantSlug}.unknown`,
      name: u?.name ?? l.name,
      user_status: "ACTIVE",
      membership_status: "ACTIVE",
      user_created_at: isoZero(),
      membership_created_at: isoZero(),
    };
  });
}

function seedPrograms(): Program[] {
  const s = seed();
  return s.programId
    ? [{ tenant_id: s.tenantId, id: s.programId, name: "Backend Engineering 2026", created_at: isoZero() }]
    : [];
}

function seedCohorts(): Cohort[] {
  const s = seed();
  return s.cohortId
    ? [{
        tenant_id: s.tenantId,
        id: s.cohortId,
        program_id: s.programId,
        name: s.cohortName,
        start_date: "",
        end_date: "",
        created_at: isoZero(),
      }]
    : [];
}

function seedDomains(): Domain[] {
  const s = seed();
  return s.domainId
    ? [{
        tenant_id: s.tenantId,
        id: s.domainId,
        owner_id: "",
        name: "Go Backend",
        description: "",
        source: "seed",
        graph_version: 1,
        status: "ACTIVE",
        phase: "INSTRUCTION",
        created_at: isoZero(),
        updated_at: isoZero(),
      }]
    : [];
}

function seedSyllabi(): Syllabus[] {
  const s = seed();
  return s.syllabusId
    ? [{
        tenant_id: s.tenantId,
        id: s.syllabusId,
        title: "Production-grade Go persistence",
        description: "Syllabus local de démonstration.",
        objectives: {},
        outcomes: {},
        created_at: isoZero(),
      }]
    : [];
}

function seedEnrollments(cohorts: Cohort[]): CohortEnrollment[] {
  const s = seed();
  const cohort = cohorts.find((c) => c.id === s.cohortId);
  if (!cohort) return [];
  return s.learners.map((l) => ({
    tenant_id: s.tenantId,
    cohort_id: cohort.id,
    learner_id: l.id,
    status: "ACTIVE",
    created_at: isoZero(),
  }));
}

function preferBackend<T>(items: T[], fallback: T[], fallbackEnabled: boolean): T[] {
  if (items.length > 0) return items;
  return fallbackEnabled ? fallback : items;
}

function sortByCreated<T extends { created_at?: string; id: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const at = a.created_at ? Date.parse(a.created_at) : 0;
    const bt = b.created_at ? Date.parse(b.created_at) : 0;
    return at - bt || a.id.localeCompare(b.id);
  });
}

export async function loadTenantContext(): Promise<TenantContext> {
  const session = await getSession();
  const fallback = explicitSeedFallbackEnabled();
  const seeded = fallback ? seed() : null;
  const tenantId = session?.tenantId ?? seeded?.tenantId ?? "";

  const errors: TenantContext["errors"] = {};
  if (!tenantId) {
    return {
      session,
      tenantId: "",
      tenantSlug: "tenant",
      tenantName: "Organisme de formation",
      programs: [],
      cohorts: [],
      domains: [],
      learners: [],
      syllabi: [],
      enrollments: [],
      enrollmentsByCohort: {},
      errors: { programs: "tenant session required" },
      usingSeedFallback: false,
    };
  }

  const [programsRes, cohortsRes, domainsRes, learnersRes, syllabiRes] = await Promise.all([
    api.get<Program[]>(tpath("/programs")),
    api.get<Cohort[]>(tpath("/cohorts")),
    api.get<Domain[]>(tpath("/domains")),
    api.get<Learner[]>(tpath("/learners")),
    api.get<Syllabus[]>(tpath("/syllabi")),
  ]);

  if (!programsRes.ok) errors.programs = programsRes.error;
  if (!cohortsRes.ok) errors.cohorts = cohortsRes.error;
  if (!domainsRes.ok) errors.domains = domainsRes.error;
  if (!learnersRes.ok) errors.learners = learnersRes.error;
  if (!syllabiRes.ok) errors.syllabi = syllabiRes.error;

  const fallbackPrograms = fallback ? seedPrograms() : [];
  const fallbackCohorts = fallback ? seedCohorts() : [];
  const fallbackDomains = fallback ? seedDomains() : [];
  const fallbackLearners = fallback ? seedLearners() : [];
  const fallbackSyllabi = fallback ? seedSyllabi() : [];

  const programs = sortByCreated(preferBackend(asArray<Program>(programsRes.ok ? programsRes.data : []), fallbackPrograms, fallback));
  const cohorts = sortByCreated(preferBackend(asArray<Cohort>(cohortsRes.ok ? cohortsRes.data : []), fallbackCohorts, fallback));
  const domains = sortByCreated(preferBackend(asArray<Domain>(domainsRes.ok ? domainsRes.data : []), fallbackDomains, fallback));
  const learners = preferBackend(asArray<Learner>(learnersRes.ok ? learnersRes.data : []), fallbackLearners, fallback);
  const syllabi = sortByCreated(preferBackend(asArray<Syllabus>(syllabiRes.ok ? syllabiRes.data : []), fallbackSyllabi, fallback));

  const enrollmentResults = await Promise.all(
    cohorts.map(async (cohort) => {
      const res = await api.get<CohortEnrollment[]>(tpath(`/cohorts/${cohort.id}/enrollments`));
      if (!res.ok) errors.enrollments = errors.enrollments ?? res.error;
      return [cohort.id, res.ok ? asArray<CohortEnrollment>(res.data) : []] as const;
    })
  );
  const fallbackEnrollments = fallback ? seedEnrollments(cohorts) : [];
  const enrollmentsByCohort: Record<string, CohortEnrollment[]> = {};
  for (const [cohortId, items] of enrollmentResults) {
    const localFallback = fallbackEnrollments.filter((e) => e.cohort_id === cohortId);
    enrollmentsByCohort[cohortId] = preferBackend(items, localFallback, fallback);
  }
  const enrollments = Object.values(enrollmentsByCohort).flat();
  const primaryCohort = cohorts.find((c) => c.id === seeded?.cohortId) ?? cohorts[0];
  const primaryProgram =
    programs.find((p) => p.id === primaryCohort?.program_id) ??
    programs.find((p) => p.id === seeded?.programId) ??
    programs[0];

  return {
    session,
    tenantId,
    tenantSlug: seeded?.tenantSlug || tenantId.slice(0, 8) || "tenant",
    tenantName: seeded?.tenantName || tenantId.slice(0, 8) || "Organisme de formation",
    programs,
    cohorts,
    domains,
    learners,
    syllabi,
    enrollments,
    enrollmentsByCohort,
    primaryProgram,
    primaryCohort,
    primaryDomain: domains.find((d) => d.id === seeded?.domainId) ?? domains[0],
    primarySyllabus: syllabi.find((s) => s.id === seeded?.syllabusId) ?? syllabi[0],
    errors,
    usingSeedFallback:
      fallback &&
      ((programsRes.ok && asArray<Program>(programsRes.data).length === 0 && programs.length > 0) ||
        (cohortsRes.ok && asArray<Cohort>(cohortsRes.data).length === 0 && cohorts.length > 0) ||
        (domainsRes.ok && asArray<Domain>(domainsRes.data).length === 0 && domains.length > 0) ||
        (learnersRes.ok && asArray<Learner>(learnersRes.data).length === 0 && learners.length > 0) ||
        (syllabiRes.ok && asArray<Syllabus>(syllabiRes.data).length === 0 && syllabi.length > 0)),
  };
}

export function learnersForCohort(ctx: TenantContext, cohortId?: string): Learner[] {
  if (!cohortId) return ctx.learners;
  const enrollments = ctx.enrollmentsByCohort[cohortId] ?? [];
  if (enrollments.length === 0) return ctx.learners;
  const byId = new Map(ctx.learners.map((l) => [l.user_id, l]));
  return enrollments
    .map((e) => byId.get(e.learner_id))
    .filter((l): l is Learner => !!l);
}

export function cohortForLearner(ctx: TenantContext, learnerId: string): Cohort | undefined {
  for (const cohort of ctx.cohorts) {
    if ((ctx.enrollmentsByCohort[cohort.id] ?? []).some((e) => e.learner_id === learnerId)) {
      return cohort;
    }
  }
  return ctx.primaryCohort;
}

export function learnerDisplay(ctx: TenantContext, learnerId: string): { name: string; email: string } {
  const learner = ctx.learners.find((l) => l.user_id === learnerId);
  if (learner) return { name: learner.name, email: learner.email };
  return { name: `user ${learnerId.slice(0, 8)}`, email: `${learnerId.slice(0, 8)}@${ctx.tenantSlug}.unknown` };
}
