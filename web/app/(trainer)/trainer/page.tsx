import Link from "next/link";
import { api, tpath, type ApiResult } from "@/lib/api";
import { learnersForCohort, loadTenantContext } from "@/lib/tenant-context";
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

function unavailable<T>(error: string): ApiResult<T> {
  return { ok: false, status: 404, error };
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    for (const key of ["items", "ids", "concept_ids", "objectives", "outcomes"]) {
      const nested = obj[key];
      if (Array.isArray(nested)) return nested.filter((v): v is string => typeof v === "string");
    }
    return Object.values(obj).filter((v): v is string => typeof v === "string");
  }
  return [];
}

export default async function TrainerHome() {
  const ctx = await loadTenantContext();
  const cohort = ctx.primaryCohort;
  const cohortId = cohort?.id ?? "";
  const cohortName = cohort?.name ?? "groupe";
  const domain = ctx.primaryDomain;
  const domainId = domain?.id ?? "";
  const rosterLearners = learnersForCohort(ctx, cohortId);

  // ---- reads (Server Components, live backend) ----
  const [graphRes, analyticsRes, alertsRes] = await Promise.all([
    domainId ? api.get<DomainGraph>(tpath(`/domains/${domainId}`)) : Promise.resolve(unavailable<DomainGraph>("no domain available")),
    cohortId ? api.get<CohortAnalytics>(tpath(`/analytics/cohorts/${cohortId}`)) : Promise.resolve(unavailable<CohortAnalytics>("no cohort available")),
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
        {/* Chrome (tenant, role, nav) lives in the layout's AppBar + AppNav. */}
        <div className="wrap" style={{ paddingTop: 14, paddingBottom: 80 }}>
          <section
            className="panel"
            style={{ maxWidth: "60ch", marginTop: 24, textAlign: "left" }}
            role="alert"
          >
            <p className="kicker" style={{ color: "var(--alarm)" }}>Console formateur · indisponible</p>
            <h1 className="standfirst" style={{ margin: "10px 0 12px" }}>
              Le runtime n&apos;a pas répondu.
            </h1>
            <p className="soft" style={{ marginBottom: 16 }}>
              Le graphe du domaine pour <strong>{cohortName}</strong> n&apos;a pas pu être joint ; il n&apos;y a
              donc rien de durable à afficher — aucun concept sur lequel rédiger, aucune liste à trier. C&apos;est
              un problème d&apos;accès au backend, pas une perte de travail. Rien n&apos;a été modifié.
            </p>
            <p className="mono quiet" style={{ fontSize: 11, marginBottom: 18 }}>
              GET /domains/{domainId.slice(0, 8)}… · pas de réponse
            </p>
            <Link href="/trainer" className="btn primary" style={{ textDecoration: "none" }}>
              Réessayer
            </Link>
          </section>
        </div>
      </main>
    );
  }

  // Per-learner runtime state + review pressure + snapshots (the durable evidence).
  const learnerData = await Promise.all(
    rosterLearners.map(async (l) => {
      const [stateRes, dueRes, snapRes] = await Promise.all([
        api.get<LearnerState[]>(tpath(`/learners/${l.user_id}/state`)),
        api.get<ReviewCard[]>(tpath(`/learners/${l.user_id}/reviews/due`)),
        api.get<PedagogicalSnapshot[]>(tpath(`/learners/${l.user_id}/snapshots`)),
      ]);
      const states = stateRes.ok ? asArray<LearnerState>(stateRes.data) : [];
      const due = dueRes.ok ? asArray<ReviewCard>(dueRes.data) : [];
      const snapshots = snapRes.ok ? asArray<PedagogicalSnapshot>(snapRes.data) : [];
      const tracked = states.length;
      const avgMastery = tracked ? states.reduce((a, x) => a + x.mastery, 0) / tracked : null;
      const avgRetention = tracked ? states.reduce((a, x) => a + x.retention, 0) / tracked : null;
      const relearning = states.filter((x) => x.card_state === "relearning").length;
      const myAlerts = alerts.filter((a) => a.learner_id === l.user_id && a.status !== "RESOLVED");
      const openAlerts = myAlerts.length;
      // An ACTIVE misconception is a runtime fact: a Misconception-type alert open on
      // this learner. It is what makes a "repair" intervention available.
      const hasMisconception = myAlerts.some((a) => a.alert_type.toLowerCase().includes("misconception"));
      const row: LearnerRow = {
        id: l.user_id,
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

  const syllabus = ctx.primarySyllabus;
  const objectiveIds = stringList(syllabus?.objectives);
  const outcomeLabels = stringList(syllabus?.outcomes);
  const liveSyllabus: SeedSyllabus = {
    id: syllabus?.id ?? "",
    title: syllabus?.title ?? "Syllabus non défini",
    description: syllabus?.description ?? "Aucun syllabus n'est encore exposé par le backend pour ce tenant.",
    objectives: objectiveIds.length
      ? objectiveIds
      : concepts.filter((c) => ["persistence", "transactions", "migrations"].includes(c.id)).map((c) => c.id),
    outcomes: outcomeLabels.length ? outcomeLabels : [
      "Ouvrir et réutiliser un pool de connexions sans fuite.",
      "Encapsuler des écritures multi-étapes dans une transaction avec un rollback correct.",
      "Appliquer des migrations en avant uniquement, en toute sécurité, sur des données en production.",
    ],
    version: 1,
    bound: true,
  };

  return (
    <main style={{ minHeight: "100vh" }}>
      {/* Chrome (tenant, role, Émargement) lives in the layout's AppBar + AppNav. */}
      <div className="wrap" style={{ paddingTop: 14, paddingBottom: 80 }}>
        <TrainerConsole
          cohortName={cohortName}
          cohortId={cohortId}
          domainName={graph?.domain.name ?? domain?.name ?? "Domaine"}
          domainId={domainId}
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
