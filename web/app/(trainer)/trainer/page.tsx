import Link from "next/link";
import { api, tpath } from "@/lib/api";
import { seed } from "@/lib/config";
import type {
  Alert,
  Concept,
  Dependency,
  DomainGraph,
  LearnerState,
  PedagogicalSnapshot,
  ReviewCard,
} from "@/lib/types";
import { TrainerConsole } from "@/components/trainer/TrainerConsole";
import type { CohortAnalytics, LearnerRow, SeedSyllabus } from "@/components/trainer/types";

export const dynamic = "force-dynamic";

// Unwrap a backend response that may be an array, null, or a wrapped object.
function asArray<T>(data: unknown, key?: string): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === "object" && key && Array.isArray((data as Record<string, unknown>)[key])) {
    return (data as Record<string, T[]>)[key];
  }
  return [];
}

export default async function TrainerHome() {
  const s = seed();

  // ---- reads (Server Components, live backend) ----
  const [graphRes, analyticsRes, alertsRes] = await Promise.all([
    api.get<DomainGraph>(tpath(`/domains/${s.domainId}`)),
    api.get<CohortAnalytics>(tpath(`/analytics/cohorts/${s.cohortId}`)),
    api.get<Alert[]>(tpath(`/alerts`)),
  ]);

  const graph: DomainGraph | null = graphRes.ok ? graphRes.data : null;
  const concepts: Concept[] = graph?.concepts ?? [];
  const dependencies: Dependency[] = graph?.dependencies ?? [];
  const analytics: CohortAnalytics | null = analyticsRes.ok ? analyticsRes.data : null;
  const alerts: Alert[] = alertsRes.ok ? asArray<Alert>(alertsRes.data) : [];

  // The domain graph is the console's spine — without it there are no concepts to author
  // against, no DAG to order, nothing to inspect. If it didn't answer, show a calm
  // on-brand "runtime didn't answer" panel rather than an empty, broken console.
  if (!graphRes.ok) {
    return (
      <main style={{ minHeight: "100vh" }}>
        <div className="wrap" style={{ paddingTop: 28, paddingBottom: 80 }}>
          <div className="spread" style={{ marginBottom: 18, flexWrap: "wrap", gap: 10 }}>
            <Link href="/" className="mono quiet" style={{ fontSize: 12 }}>
              ← LORE
            </Link>
            <span className="mono quiet" style={{ fontSize: 11, letterSpacing: "0.05em" }}>
              tenant {s.tenantSlug} · TRAINER · R. Köhler
            </span>
          </div>
          <section
            className="panel"
            style={{ maxWidth: "60ch", marginTop: 24, textAlign: "left" }}
            role="alert"
          >
            <p className="kicker" style={{ color: "var(--alarm)" }}>Trainer console · unavailable</p>
            <h1 className="standfirst" style={{ margin: "10px 0 12px" }}>
              The runtime didn&apos;t answer.
            </h1>
            <p className="soft" style={{ marginBottom: 16 }}>
              The domain graph for <strong>{s.cohortName}</strong> couldn&apos;t be reached, so there&apos;s
              nothing durable to show — no concepts to author against, no roster to triage. This is a backend
              reachability problem, not lost work. Nothing has been changed.
            </p>
            <p className="mono quiet" style={{ fontSize: 11, marginBottom: 18 }}>
              GET /domains/{s.domainId.slice(0, 8)}… · no response
            </p>
            <Link href="/trainer" className="btn primary" style={{ textDecoration: "none" }}>
              Retry
            </Link>
          </section>
        </div>
      </main>
    );
  }

  // Per-learner runtime state + review pressure + snapshots (the durable evidence).
  const learnerData = await Promise.all(
    s.learners.map(async (l) => {
      const [stateRes, dueRes, snapRes] = await Promise.all([
        api.get<LearnerState[]>(tpath(`/learners/${l.id}/state`)),
        api.get<ReviewCard[]>(tpath(`/learners/${l.id}/reviews/due`)),
        api.get<PedagogicalSnapshot[]>(tpath(`/learners/${l.id}/snapshots`)),
      ]);
      const states = stateRes.ok ? asArray<LearnerState>(stateRes.data) : [];
      const due = dueRes.ok ? asArray<ReviewCard>(dueRes.data) : [];
      const snapshots = snapRes.ok ? asArray<PedagogicalSnapshot>(snapRes.data) : [];
      const tracked = states.length;
      const avgMastery = tracked ? states.reduce((a, x) => a + x.mastery, 0) / tracked : null;
      const avgRetention = tracked ? states.reduce((a, x) => a + x.retention, 0) / tracked : null;
      const relearning = states.filter((x) => x.card_state === "relearning").length;
      const myAlerts = alerts.filter((a) => a.learner_id === l.id && a.status !== "RESOLVED");
      const openAlerts = myAlerts.length;
      // An ACTIVE misconception is a runtime fact: a Misconception-type alert open on
      // this learner. It is what makes a "repair" intervention available.
      const hasMisconception = myAlerts.some((a) => a.alert_type.toLowerCase().includes("misconception"));
      const row: LearnerRow = {
        id: l.id,
        name: l.name,
        tracked,
        avgMastery,
        avgRetention,
        relearning,
        due: due.length,
        openAlerts,
        alerts: myAlerts,
        hasMisconception,
        states,
        snapshots,
      };
      return row;
    })
  );

  // The seeded, live syllabus (the backend exposes no list/get for syllabi —
  // it is bound to this cohort and is the source of the learners' provenance).
  const liveSyllabus: SeedSyllabus = {
    id: s.syllabusId,
    title: "Production-grade Go persistence",
    description:
      "Author durable, transactional persistence for a Go backend — connection lifecycle, transactions, and safe migrations.",
    objectives: concepts.filter((c) => ["persistence", "transactions", "migrations"].includes(c.id)).map((c) => c.id),
    outcomes: [
      "Open and reuse a connection pool without leaks.",
      "Wrap multi-step writes in a transaction with correct rollback.",
      "Apply forward-only migrations safely against live data.",
    ],
    version: 1,
    bound: true,
  };

  return (
    <main style={{ minHeight: "100vh" }}>
      <div className="wrap" style={{ paddingTop: 28, paddingBottom: 80 }}>
        <div className="spread" style={{ marginBottom: 18, flexWrap: "wrap", gap: 10 }}>
          <Link href="/" className="mono quiet" style={{ fontSize: 12 }}>
            ← LORE
          </Link>
          <span className="mono quiet" style={{ fontSize: 11, letterSpacing: "0.05em" }}>
            tenant {s.tenantSlug} · TRAINER · R. Köhler
          </span>
        </div>

        <TrainerConsole
          cohortName={s.cohortName}
          cohortId={s.cohortId}
          domainName={graph?.domain.name ?? "Go Backend"}
          domainId={s.domainId}
          concepts={concepts}
          dependencies={dependencies}
          liveSyllabus={liveSyllabus}
          analytics={analytics}
          alerts={alerts}
          learners={learnerData}
          backendOk={graphRes.ok && alertsRes.ok}
        />
      </div>
    </main>
  );
}
