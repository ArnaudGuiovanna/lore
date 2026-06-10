import Link from "next/link";
import { api, tpath, type ApiResult } from "@/lib/api";
import { getSession } from "@/lib/auth/session";
import { listCredentials } from "@/lib/auth/store";
import { learnerDisplay, learnersForCohort, loadTenantContext } from "@/lib/tenant-context";
import type { Alert, Concept, Dependency, LLMConfiguration, LoreEvent, Membership, LearnerState, ReviewCard, Role } from "@/lib/types";
import { AdminConsole } from "@/components/admin/AdminConsole";
import type {
  BoundSyllabus,
  CohortNode,
  DomainGraphData,
  EnrollableLearner,
  ManagedProgram,
  MembershipRow,
  OutboxEvent,
  ProgramNode,
  RosterRow,
  ScopeRow,
} from "@/components/admin/types";

export const dynamic = "force-dynamic";

// Backend wraps the domain read as { domain, concepts, dependencies }.
interface DomainEnvelope {
  domain: { name: string; graph_version: number };
  concepts: Concept[];
  dependencies: Dependency[];
}

// The real outbox events carry occurred_at (not created_at) and no published flag.
type RawEvent = LoreEvent & { occurred_at?: string; published?: boolean };

// Cohort analytics envelope — runtime-owned aggregate (BKT). Used for the
// overview's evidence metrics (average mastery), never client-computed.
interface CohortAnalytics {
  average_mastery: number;
  active_misconceptions: number;
  learner_count: number;
  state_count: number;
  // FOAD training time (B-07) — pauses excluded, per-activity capped.
  training_hours?: number;
}

// A backend llm-configuration is only "really set" when it has a non-zero timestamp.
function isExplicit(c: LLMConfiguration | null): boolean {
  if (!c || !c.provider) return false;
  const t = c.created_at || "";
  return !t.startsWith("0001-01-01") && t !== "";
}

function unavailable<T>(error: string): ApiResult<T> {
  return { ok: false, status: 404, error };
}

export default async function AdminHome() {
  const session = await getSession();
  const ctx = await loadTenantContext();
  const cohort = ctx.primaryCohort;
  const cohortId = cohort?.id ?? "";
  const cohortName = cohort?.name ?? "groupe";
  const programInfo = ctx.primaryProgram;
  const programId = programInfo?.id ?? "";
  const domain = ctx.primaryDomain;
  const domainId = domain?.id ?? "";
  const rosterLearners = learnersForCohort(ctx, cohortId);
  const syllabus = ctx.primarySyllabus;

  // ---- reads (Server Components, live backend) ----
  const [domainRes, tenantCfgRes, cohortCfgRes, outboxRes, analyticsRes, alertsRes, membershipsRes] = await Promise.all([
    domainId ? api.get<DomainEnvelope>(tpath(`/domains/${domainId}`)) : Promise.resolve(unavailable<DomainEnvelope>("no domain available")),
    api.get<LLMConfiguration>(tpath(`/llm-configurations`)),
    cohortId ? api.get<LLMConfiguration>(tpath(`/llm-configurations?scope_type=cohort&scope_id=${cohortId}`)) : Promise.resolve(unavailable<LLMConfiguration>("no cohort available")),
    api.get<RawEvent[]>(tpath(`/events/outbox`)),
    cohortId ? api.get<CohortAnalytics>(tpath(`/analytics/cohorts/${cohortId}`)) : Promise.resolve(unavailable<CohortAnalytics>("no cohort available")),
    api.get<Alert[]>(tpath(`/alerts`)),
    api.get<Membership[]>(tpath(`/memberships`)),
  ]);

  // Per-learner LLM overrides (most-specific scope tier).
  const learnerCfgs = await Promise.all(
    ctx.learners.map((l) =>
      api.get<LLMConfiguration>(tpath(`/llm-configurations?scope_type=learner&scope_id=${l.user_id}`))
    )
  );

  const backendOk = domainRes.ok && tenantCfgRes.ok && outboxRes.ok;

  // The control plane has nothing legible to show if every core read failed: no
  // domain DAG to validate, no tenant LLM default, no outbox trace. Rather than a
  // shell of empty panels, show a calm on-brand "runtime didn't answer" panel —
  // mirroring the trainer surface. A partial failure (some reads ok) degrades
  // gracefully in-console instead (see AdminConsole's degraded banner).
  const coreDown = !domainRes.ok && !tenantCfgRes.ok && !outboxRes.ok;
  if (coreDown) {
    return (
      <main style={{ minHeight: "100vh" }}>
        {/* Chrome (tenant, role, nav) lives in the layout's AppBar + AppNav. */}
        <div className="wrap" style={{ paddingTop: 14, paddingBottom: 80 }}>
          <section className="panel" style={{ maxWidth: "60ch", marginTop: 24 }} role="alert">
            <p className="kicker" style={{ color: "var(--alarm)" }}>Plan de contrôle · indisponible</p>
            <h1 className="standfirst" style={{ margin: "10px 0 12px" }}>
              Le runtime n&apos;a pas répondu.
            </h1>
            <p className="soft" style={{ marginBottom: 16, maxWidth: "58ch" }}>
              Le plan de contrôle du tenant n&apos;a pas pu joindre le runtime ; il n&apos;y a donc rien de durable à
              afficher — aucun DAG de domaine à valider, aucun défaut LLM, aucune trace d&apos;outbox. C&apos;est un
              problème d&apos;accès au backend, pas une perte de configuration. Rien n&apos;a été modifié.
            </p>
            <p className="mono quiet" style={{ fontSize: 11, marginBottom: 18, wordBreak: "break-word" }}>
              GET /domains/{domainId.slice(0, 8)}… · GET /llm-configurations · GET /events/outbox · pas de réponse
            </p>
            <Link href="/admin" className="btn primary" style={{ textDecoration: "none" }}>
              ↺ Réessayer
            </Link>
          </section>
        </div>
      </main>
    );
  }

  // ---- domain graph (read-only DAG) ----
  const env = domainRes.ok ? domainRes.data : null;
  const graph: DomainGraphData = {
    domainName: env?.domain.name ?? domain?.name ?? "Domaine",
    domainId,
    graphVersion: env?.domain.graph_version ?? domain?.graph_version ?? 1,
    concepts: env?.concepts ?? [],
    dependencies: env?.dependencies ?? [],
  };

  // ---- LLM configuration matrix (most-specific-first hierarchy) ----
  const tenantCfg = tenantCfgRes.ok ? tenantCfgRes.data : null;
  const cohortCfgRaw = cohortCfgRes.ok ? cohortCfgRes.data : null;
  const cohortCfg = isExplicit(cohortCfgRaw) ? cohortCfgRaw : null;

  const matrix: ScopeRow[] = [
    {
      tier: "tenant",
      scopeId: "",
      label: `${ctx.tenantName || ctx.tenantSlug} · tenant`,
      config: tenantCfg,
      editable: true,
    },
    {
      tier: "program",
      scopeId: programId,
      label: programInfo?.name ?? "Programme",
      config: null, // no explicit program override endpoint yet
      editable: true,
    },
    {
      tier: "cohort",
      scopeId: cohortId,
      label: cohortName,
      config: cohortCfg,
      editable: true,
    },
    ...ctx.learners.map((l, i): ScopeRow => {
      const raw = learnerCfgs[i].ok ? learnerCfgs[i].data : null;
      return {
        tier: "learner",
        scopeId: l.user_id,
        label: l.name,
        hint: l.user_id,
        config: isExplicit(raw) ? raw : null,
        editable: true,
      };
    }),
  ];

  // ---- runtime-owned evidence (overview): cohort avg mastery + open alerts ----
  // These are aggregates the RUNTIME computes (BKT / SR scheduler). The admin
  // observes them; the UI never recomputes pedagogy from raw rows.
  const analytics = analyticsRes.ok ? analyticsRes.data : null;
  const alerts = alertsRes.ok && Array.isArray(alertsRes.data) ? alertsRes.data : [];
  const openAlerts = alerts.filter((al) => al.status === "OPEN");
  const highAlerts = openAlerts.filter((al) => {
    const sv = (al.severity ?? "").toLowerCase();
    return sv === "high" || sv === "critical";
  }).length;

  // ---- identity & memberships (role derived from membership, joined with the
  // credential store + backend learner list for human names/emails). The backend's GET
  // /memberships is the source of truth for who-holds-which-role; names/emails
  // come from the frontend identity sources. userId enables role re-grant.
  const credentials = await listCredentials();
  const nameForUser = (userId: string): { name: string; email: string } => {
    const cred = credentials.find((c) => c.userId === userId);
    if (cred) return { name: cred.name, email: cred.email };
    return learnerDisplay(ctx, userId);
  };

  const liveMemberships = membershipsRes.ok && Array.isArray(membershipsRes.data) ? membershipsRes.data : [];
  const selfId = session?.userId;
  const memberships: MembershipRow[] = liveMemberships.length
    ? liveMemberships
        .map((m): MembershipRow => {
          const who = nameForUser(m.user_id);
          const isSelf = m.user_id === selfId;
          return {
            name: who.name,
            email: who.email,
            role: m.role,
            scope: `tenant · ${ctx.tenantSlug}`,
            status: isSelf ? `${m.status.toLowerCase()} · vous` : m.status.toLowerCase(),
            self: isSelf,
            userId: m.user_id,
            // a tenant admin can re-grant anyone except a SUPER_ADMIN or themselves
            manageable: m.role !== "SUPER_ADMIN" && !isSelf,
          };
        })
        .sort((a, b) => {
          const order: Record<Role, number> = { SUPER_ADMIN: 0, TENANT_ADMIN: 1, TRAINER: 2, LEARNER: 3 };
          return order[a.role] - order[b.role] || a.name.localeCompare(b.name);
        })
    : // Honest fallback if the backend returns no memberships: derive from the
      // credential store (real local identities) so the screen is never fabricated.
      credentials.map((c): MembershipRow => {
        const isSelf = c.userId === selfId;
        return {
          name: c.name,
          email: c.email,
          role: c.role,
          scope: `tenant · ${ctx.tenantSlug}`,
          status: isSelf ? "actif · vous" : "actif",
          self: isSelf,
          userId: c.userId,
          manageable: c.role !== "SUPER_ADMIN" && !isSelf,
        };
      });

  // ---- outbox (real persisted domain events) ----
  const rawEvents: RawEvent[] = outboxRes.ok && Array.isArray(outboxRes.data) ? outboxRes.data : [];

  // Programs and cohorts as created on the backend list endpoints.
  const programMap = new Map<string, ManagedProgram>();
  for (const p of ctx.programs) {
    programMap.set(p.id, { id: p.id, name: p.name, cohorts: [] });
  }
  for (const c of ctx.cohorts) {
    const pid = c.program_id || programId;
    if (!programMap.has(pid)) {
      programMap.set(pid, { id: pid, name: pid || "Programme", cohorts: [] });
    }
    programMap.get(pid)!.cohorts.push({ id: c.id, name: c.name, programId: pid });
  }
  const programs: ManagedProgram[] = Array.from(programMap.values());

  // Learners the admin can enroll (the tenant's live learners).
  const enrollableLearners: EnrollableLearner[] = ctx.learners.map((l) => ({ id: l.user_id, name: l.name }));

  // ---- live roster for the selected cohort: enrolled learners + runtime state ----
  const rosterIds = rosterLearners.map((l) => l.user_id);
  const rosterStates = await Promise.all(
    rosterIds.map((id) =>
      Promise.all([
        api.get<LearnerState[]>(tpath(`/learners/${id}/state`)),
        api.get<ReviewCard[]>(tpath(`/learners/${id}/reviews/due`)),
      ])
    )
  );
  const roster: RosterRow[] = rosterIds.map((id, i): RosterRow => {
    const who = nameForUser(id);
    const [stateRes, dueRes] = rosterStates[i];
    const states = stateRes.ok && Array.isArray(stateRes.data) ? stateRes.data : null;
    const due = dueRes.ok && Array.isArray(dueRes.data) ? dueRes.data.length : null;
    const avgMastery =
      states && states.length ? states.reduce((sum, st) => sum + (st.mastery ?? 0), 0) / states.length : null;
    return {
      learnerId: id,
      name: who.name,
      enrolled: true,
      avgMastery,
      concepts: states ? states.length : 0,
      dueReviews: due,
    };
  });

  // ---- org structure (programs › cohorts › enrollment + read-only bound syllabi) ----
  const bound: BoundSyllabus[] = syllabus
    ? [{
        title: syllabus.title,
        syllabusId: syllabus.id,
        targetType: "COHORT",
        targetId: cohortId,
        adaptationMode: "GUIDED",
        author: "Formateur",
        domainName: graph.domainName,
      }]
    : [];
  const trainerMembers = liveMemberships
    .filter((m) => m.role === "TRAINER")
    .map((m, i) => ({ name: nameForUser(m.user_id).name, role: "TRAINER" as const, lead: i === 0 }));
  const enrollment = [
    ...trainerMembers,
    ...rosterLearners.map((l) => ({ name: l.name, role: "LEARNER" as const })),
  ];
  const cohortNode: CohortNode = {
    id: cohortId,
    name: cohortName,
    leadName: trainerMembers[0]?.name ?? "Formateur",
    enrollment,
    extraLearners: Math.max(0, ctx.learners.length - rosterLearners.length),
    bound,
  };
  const program: ProgramNode = {
    id: programId,
    name: programInfo?.name ?? "Programme",
    cohorts: cohortId ? [cohortNode] : [],
  };

  // ---- event outbox (real persisted domain events) ----
  const events: OutboxEvent[] = rawEvents.map((e) => ({
    id: e.id,
    eventType: e.event_type,
    aggregateType: e.aggregate_type,
    aggregateId: e.aggregate_id,
    occurredAt: e.occurred_at ?? e.created_at ?? "",
    // Backend exposes no publish ack on these rows — honest default: unpublished.
    published: e.published === true,
    payload: e.payload,
    annotation:
      e.event_type === "SyllabusBound" || e.event_type === "SyllabusCreated"
        ? "par le formateur R. Köhler — pas une action d'admin"
        : undefined,
  }));

  return (
    <main style={{ minHeight: "100vh" }}>
      {/* Chrome (tenant, role, RGPD) lives in the layout's AppBar + AppNav. */}
      <div className="wrap" style={{ paddingTop: 14, paddingBottom: 90 }}>
        <AdminConsole
          tenantSlug={ctx.tenantSlug}
          tenantName={ctx.tenantName || ctx.tenantSlug}
          program={program}
          programs={programs}
          enrollableLearners={enrollableLearners}
          roster={roster}
          rosterCohortName={cohortName}
          memberships={memberships}
          graph={graph}
          matrix={matrix}
          events={events}
          learnerCount={analytics ? analytics.learner_count : roster.length}
          avgMastery={analytics ? analytics.average_mastery : null}
          trainingHours={analytics && typeof analytics.training_hours === "number" ? analytics.training_hours : null}
          trainingTimeCsvHref={cohortId ? `/api/analytics/training-time?cohortId=${encodeURIComponent(cohortId)}` : undefined}
          openAlerts={openAlerts.length}
          highAlerts={highAlerts}
          backendOk={backendOk}
        />
      </div>
    </main>
  );
}
