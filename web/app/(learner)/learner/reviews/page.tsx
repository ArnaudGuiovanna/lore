import Link from "next/link";
import { seed } from "@/lib/config";
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
  const s = seed();
  const learner = await activeLearner();
  const [cardsRes, graphRes] = await Promise.all([
    loadReviewsDue(learner.id),
    loadDomainGraph(s.domainId),
  ]);

  if (!cardsRes.ok) {
    return (
      <div className="col" style={{ gap: 22 }}>
        <div className="col" style={{ gap: 8 }}>
          <span className="kicker">Reviews</span>
          <h1 className="standfirst">Spaced recall, due now.</h1>
        </div>
        <LearnerError
          detail="We couldn't reach the runtime to read your due reviews. Nothing is lost — your FSRS schedule lives on the backend."
          message={cardsRes.error}
        />
      </div>
    );
  }

  const cards = cardsRes.data;
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
      header: "Due",
      mono: true,
      render: (r) => (
        <span style={{ color: r.overdue ? "var(--alarm)" : "var(--ink)" }}>
          {fmtDate(r.due_at, true)} {r.overdue ? "· overdue" : ""}
        </span>
      ),
    },
    { key: "state", header: "Card", mono: true, render: (r) => <Pill>{r.state}</Pill> },
    { key: "retention", header: "Retention", align: "right", mono: true, render: (r) => fmtPct(r.retention) },
    { key: "reps", header: "Reps", align: "right", mono: true },
    { key: "lapses", header: "Lapses", align: "right", mono: true },
  ];

  return (
    <div className="col" style={{ gap: 22 }}>
      <div className="col" style={{ gap: 8 }}>
        <span className="kicker">Reviews</span>
        <h1 className="standfirst">Spaced recall, due now.</h1>
        <p className="soft" style={{ maxWidth: "62ch", fontSize: 15, lineHeight: 1.6 }}>
          The runtime schedules these with FSRS. {rows.length} due
          {overdueCount ? `, ${overdueCount} overdue` : ""}. Clear them from{" "}
          <Link href="/learner" style={{ color: "var(--accent)" }}>
            Now
          </Link>{" "}
          — recall feeds back into your retention.
        </p>
      </div>
      <DataTable<Row>
        columns={columns}
        rows={rows}
        rowKey={(r, i) => `${r.concept}-${i}`}
        empty="Nothing due. Retention is holding."
      />
    </div>
  );
}
