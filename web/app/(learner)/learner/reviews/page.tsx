import Link from "next/link";
import { loadTenantContext } from "@/lib/tenant-context";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Pill } from "@/components/Mark";
import { fmtDate, fmtPct } from "@/lib/format";
import { activeLearner, conceptName, loadDomainGraph, loadReviewsDue } from "@/components/learner/data";
import { LearnerError } from "@/components/learner/LearnerStatus";
import type { ReviewCard } from "@/lib/types";

export const dynamic = "force-dynamic";

interface Row extends Record<string, unknown> {
  concept: string;
  due_at: string;
  overdue: boolean;
  state: string;
  retention: number;
  reps: number;
  lapses: number;
}

export default async function ReviewsScreen() {
  const learner = await activeLearner();
  const [ctx, cardsRes] = await Promise.all([
    loadTenantContext(),
    loadReviewsDue(learner.id),
  ]);

  if (!cardsRes.ok) {
    return (
      <div className="col" style={{ gap: 22 }}>
        <div className="col" style={{ gap: 8 }}>
          <span className="kicker">Révisions</span>
          <h1 className="standfirst">Rappel espacé, à faire maintenant.</h1>
        </div>
        <LearnerError
          detail="Nous n'avons pas pu joindre le runtime pour lire vos révisions à faire. Rien n'est perdu — votre planning FSRS est sur le backend."
          message={cardsRes.error}
        />
      </div>
    );
  }

  const cards = cardsRes.data;
  const domainId = cards[0]?.domain_id || ctx.primaryDomain?.id || "";
  const graphRes = await loadDomainGraph(domainId);
  const graph = graphRes.ok ? graphRes.data : { concepts: [], dependencies: [] };
  const now = Date.now();

  const rows: Row[] = cards.map((c: ReviewCard) => ({
    concept: conceptName(graph.concepts, c.concept_id),
    due_at: c.due_at,
    overdue: new Date(c.due_at).getTime() <= now,
    state: c.state,
    retention: c.retention,
    reps: c.reps,
    lapses: c.lapses,
  }));

  const overdueCount = rows.filter((r) => r.overdue).length;

  const columns: Column<Row>[] = [
    { key: "concept", header: "Concept", render: (r) => <strong>{r.concept}</strong> },
    {
      key: "due_at",
      header: "Échéance",
      mono: true,
      render: (r) => (
        <span style={{ color: r.overdue ? "var(--alarm)" : "var(--ink)" }}>
          {fmtDate(r.due_at, true)} {r.overdue ? "· en retard" : ""}
        </span>
      ),
    },
    { key: "state", header: "Carte", mono: true, render: (r) => <Pill>{r.state}</Pill> },
    { key: "retention", header: "Rétention", align: "right", mono: true, render: (r) => fmtPct(r.retention) },
    { key: "reps", header: "Répét.", align: "right", mono: true },
    { key: "lapses", header: "Oublis", align: "right", mono: true },
  ];

  return (
    <div className="col" style={{ gap: 22 }}>
      <div className="col" style={{ gap: 8 }}>
        <span className="kicker">Révisions</span>
        <h1 className="standfirst">Rappel espacé, à faire maintenant.</h1>
        <p className="soft" style={{ maxWidth: "62ch", fontSize: 15, lineHeight: 1.6 }}>
          Le runtime les planifie avec FSRS. {rows.length} à faire
          {overdueCount ? `, ${overdueCount} en retard` : ""}. Traitez-les depuis{" "}
          <Link href="/learner" style={{ color: "var(--accent)" }}>
            Maintenant
          </Link>{" "}
          — le rappel renforce votre rétention.
        </p>
      </div>
      <DataTable<Row>
        columns={columns}
        rows={rows}
        rowKey={(r, i) => `${r.concept}-${i}`}
        empty="Rien à faire. La rétention tient."
      />
    </div>
  );
}
