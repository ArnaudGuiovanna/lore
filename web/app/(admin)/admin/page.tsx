import Link from "next/link";
import { api, tpath } from "@/lib/api";
import { seed } from "@/lib/config";
import { getSession } from "@/lib/auth/session";
import { listCredentials } from "@/lib/auth/store";
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
}

// A backend llm-configuration is only "really set" when it has a non-zero timestamp.
function isExplicit(c: LLMConfiguration | null): boolean {
  if (!c || !c.provider) return false;
  const t = c.created_at || "";
  return !t.startsWith("0001-01-01") && t !== "";
}

export default async function AdminHome() {
  const s = seed();
  const session = await getSession();

  // ---- reads (Server Components, live backend) ----
  const [domainRes, tenantCfgRes, cohortCfgRes, outboxRes, analyticsRes, alertsRes, membershipsRes] = await Promise.all([
    api.get<DomainEnvelope>(tpath(`/domains/${s.domainId}`)),
    api.get<LLMConfiguration>(tpath(`/llm-configurations`)),
    api.get<LLMConfiguration>(tpath(`/llm-configurations?scope_type=cohort&scope_id=${s.cohortId}`)),
    api.get<RawEvent[]>(tpath(`/events/outbox`)),
    api.get<CohortAnalytics>(tpath(`/analytics/cohorts/${s.cohortId}`)),
    api.get<Alert[]>(tpath(`/alerts`)),
    api.get<Membership[]>(tpath(`/memberships`)),
  ]);

  // Per-learner LLM overrides (most-specific scope tier).
  const learnerCfgs = await Promise.all(
    s.learners.map((l) =>
      api.get<LLMConfiguration>(tpath(`/llm-configurations?scope_type=learner&scope_id=${l.id}`))
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
        <div className="wrap" style={{ paddingTop: 28, paddingBottom: 80 }}>
          <div className="spread" style={{ marginBottom: 18, flexWrap: "wrap", gap: 10 }}>
            <Link href="/" className="mono quiet" style={{ fontSize: 12 }}>
              ← LORE
            </Link>
            <span className="mono quiet" style={{ fontSize: 11, letterSpacing: "0.05em" }}>
              tenant {s.tenantSlug} · TENANT_ADMIN · S. Aalto
            </span>
          </div>
          <section className="panel" style={{ maxWidth: "60ch", marginTop: 24 }} role="alert">
            <p className="kicker" style={{ color: "var(--alarm)" }}>Control plane · unavailable</p>
            <h1 className="standfirst" style={{ margin: "10px 0 12px" }}>
              The runtime didn&apos;t answer.
            </h1>
            <p className="soft" style={{ marginBottom: 16, maxWidth: "58ch" }}>
              The tenant control plane couldn&apos;t reach the runtime, so there&apos;s nothing durable to
              show — no domain DAG to validate, no LLM defaults, no outbox trace. This is a backend
              reachability problem, not lost configuration. Nothing has been changed.
            </p>
            <p className="mono quiet" style={{ fontSize: 11, marginBottom: 18, wordBreak: "break-word" }}>
              GET /domains/{s.domainId.slice(0, 8)}… · GET /llm-configurations · GET /events/outbox · no response
            </p>
            <Link href="/admin" className="btn primary" style={{ textDecoration: "none" }}>
              ↺ Retry
            </Link>
          </section>
        </div>
      </main>
    );
  }

  // ---- domain graph (read-only DAG) ----
  const env = domainRes.ok ? domainRes.data : null;
  const graph: DomainGraphData = {
    domainName: env?.domain.name ?? "Go Backend",
    domainId: s.domainId,
    graphVersion: env?.domain.graph_version ?? 1,
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
      label: `${s.tenantSlug === "acme" ? "Acme Learning" : s.tenantSlug} · tenant`,
      config: tenantCfg,
      editable: true,
    },
    {
      tier: "program",
      scopeId: s.programId,
      label: "Backend Engineering 2026",
      config: null, // no explicit program override seeded
      editable: true,
    },
    {
      tier: "cohort",
      scopeId: s.cohortId,
      label: s.cohortName,
      config: cohortCfg,
      editable: true,
    },
    ...s.learners.map((l, i): ScopeRow => {
      const raw = learnerCfgs[i].ok ? learnerCfgs[i].data : null;
      return {
        tier: "learner",
        scopeId: l.id,
        label: l.name,
        hint: l.id,
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
  // credential store + seed for human names/emails). The backend's GET
  // /memberships is the source of truth for who-holds-which-role; names/emails
  // come from the frontend identity sources. userId enables role re-grant.
  const credentials = await listCredentials();
  const nameForUser = (userId: string): { name: string; email: string } => {
    const cred = credentials.find((c) => c.userId === userId);
    if (cred) return { name: cred.name, email: cred.email };
    const seeded = s.users.find((u) => u.id === userId);
    if (seeded) return { name: seeded.name, email: seeded.email };
    const learner = s.learners.find((l) => l.id === userId);
    if (learner) return { name: learner.name, email: `${userId.slice(0, 8)}@${s.tenantSlug}.unknown` };
    return { name: `user ${userId.slice(0, 8)}`, email: `${userId.slice(0, 8)}@${s.tenantSlug}.unknown` };
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
            scope: `tenant · ${s.tenantSlug}`,
            status: isSelf ? `${m.status.toLowerCase()} · you` : m.status.toLowerCase(),
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
          scope: `tenant · ${s.tenantSlug}`,
          status: isSelf ? "active · you" : "active",
          self: isSelf,
          userId: c.userId,
          manageable: c.role !== "SUPER_ADMIN" && !isSelf,
        };
      });

  // ---- outbox (real persisted domain events) — also the live source for the
  // program/cohort/enrollment lists, since the backend has no GET for those. ----
  const rawEvents: RawEvent[] = outboxRes.ok && Array.isArray(outboxRes.data) ? outboxRes.data : [];

  // Programs and cohorts as created on the backend (ProgramCreated / CohortCreated
  // events carry id + name in payload). Always includes the seeded program/cohort.
  const programMap = new Map<string, ManagedProgram>();
  programMap.set(s.programId, {
    id: s.programId,
    name: "Backend Engineering 2026",
    cohorts: [],
  });
  for (const e of rawEvents) {
    if (e.event_type === "ProgramCreated" && e.aggregate_id) {
      const name = String((e.payload as { name?: string })?.name ?? "program");
      if (!programMap.has(e.aggregate_id)) programMap.set(e.aggregate_id, { id: e.aggregate_id, name, cohorts: [] });
      else programMap.get(e.aggregate_id)!.name = name;
    }
  }
  // seed the known cohort under its program
  programMap.get(s.programId)!.cohorts.push({ id: s.cohortId, name: s.cohortName, programId: s.programId });
  for (const e of rawEvents) {
    if (e.event_type === "CohortCreated" && e.aggregate_id) {
      const p = e.payload as { program_id?: string; name?: string };
      const pid = String(p?.program_id ?? s.programId);
      const prog = programMap.get(pid) ?? programMap.get(s.programId)!;
      if (!prog.cohorts.some((c) => c.id === e.aggregate_id)) {
        prog.cohorts.push({ id: e.aggregate_id, name: String(p?.name ?? "cohort"), programId: prog.id });
      }
    }
  }
  const programs: ManagedProgram[] = Array.from(programMap.values());

  // Learners the admin can enroll (the tenant's known/seeded learners).
  const enrollableLearners: EnrollableLearner[] = s.learners.map((l) => ({ id: l.id, name: l.name }));

  // ---- live roster for the seeded cohort: enrolled learners + runtime state ----
  // Enrolled ids = seeded learners ∪ anyone in a LearnerEnrolled event for this cohort.
  const enrolledIds = new Set<string>(s.learners.map((l) => l.id));
  for (const e of rawEvents) {
    if (e.event_type === "LearnerEnrolled") {
      const p = e.payload as { cohort_id?: string; learner_id?: string };
      if (p?.cohort_id === s.cohortId && p?.learner_id) enrolledIds.add(p.learner_id);
    }
  }
  const rosterIds = Array.from(enrolledIds);
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
  const bound: BoundSyllabus[] = [
    {
      title: "Production-grade Go persistence",
      syllabusId: s.syllabusId,
      targetType: "COHORT",
      targetId: s.cohortId,
      adaptationMode: "GUIDED",
      author: "R. Köhler",
      domainName: graph.domainName,
    },
  ];
  const enrollment = [
    { name: "R. Köhler", role: "TRAINER" as const, lead: true },
    ...s.learners.map((l) => ({ name: l.name, role: "LEARNER" as const })),
  ];
  const cohortNode: CohortNode = {
    id: s.cohortId,
    name: s.cohortName,
    leadName: "R. Köhler",
    enrollment,
    extraLearners: 14,
    bound,
  };
  const program: ProgramNode = {
    id: s.programId,
    name: "Backend Engineering 2026",
    cohorts: [cohortNode],
  };

  // ---- event outbox (real persisted domain events; SyllabusCreated/Bound from seed) ----
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
        ? "by trainer R. Köhler — not an admin action"
        : undefined,
  }));

  return (
    <main style={{ minHeight: "100vh" }}>
      <div className="wrap" style={{ paddingTop: 28, paddingBottom: 90 }}>
        <div className="spread" style={{ marginBottom: 18, flexWrap: "wrap", gap: 10 }}>
          <Link href="/" className="mono quiet" style={{ fontSize: 12 }}>
            ← LORE
          </Link>
          <span className="row" style={{ gap: 16, alignItems: "center" }}>
            <Link href="/admin/rgpd" className="mono" style={{ fontSize: 12, textDecoration: "underline" }}>
              RGPD / Données personnelles →
            </Link>
            <span className="mono quiet" style={{ fontSize: 11, letterSpacing: "0.05em" }}>
              tenant {s.tenantSlug} · TENANT_ADMIN · S. Aalto
            </span>
          </span>
        </div>

        <AdminConsole
          tenantSlug={s.tenantSlug}
          tenantName={s.tenantSlug === "acme" ? "Acme Learning" : s.tenantSlug}
          program={program}
          programs={programs}
          enrollableLearners={enrollableLearners}
          roster={roster}
          rosterCohortName={s.cohortName}
          memberships={memberships}
          graph={graph}
          matrix={matrix}
          events={events}
          learnerCount={s.learners.length + cohortNode.extraLearners}
          avgMastery={analytics ? analytics.average_mastery : null}
          openAlerts={openAlerts.length}
          highAlerts={highAlerts}
          backendOk={backendOk}
        />
      </div>
    </main>
  );
}
