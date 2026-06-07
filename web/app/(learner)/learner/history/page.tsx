import Link from "next/link";
import { seed } from "@/lib/config";
import { Timeline, type TimelineItem } from "@/components/ui/Timeline";
import { fmtDate, fmtPct } from "@/lib/format";
import { activeLearner, conceptName, loadDomainGraph, loadSnapshots } from "@/components/learner/data";
import { LearnerError, LearnerEmpty } from "@/components/learner/LearnerStatus";
import type { LearnerState, PedagogicalSnapshot } from "@/lib/types";

export const dynamic = "force-dynamic";

function stateOf(slot: unknown): LearnerState | undefined {
  if (slot && typeof slot === "object" && "state" in slot) {
    return (slot as { state?: LearnerState }).state;
  }
  return undefined;
}

function masteryLine(slot: unknown): string {
  const st = stateOf(slot);
  if (!st) return "—";
  return `mastery ${fmtPct(st.mastery)} · retention ${fmtPct(st.retention)} · ${st.card_state}`;
}

export default async function HistoryScreen() {
  const s = seed();
  const learner = await activeLearner();
  const [snapsRes, graphRes] = await Promise.all([
    loadSnapshots(learner.id),
    loadDomainGraph(s.domainId),
  ]);

  const header = (
    <div className="col" style={{ gap: 8 }}>
      <span className="kicker">History</span>
      <h1 className="standfirst">Every step the runtime took with you.</h1>
      <p className="soft" style={{ maxWidth: "62ch", fontSize: 15, lineHeight: 1.6 }}>
        Pedagogical snapshots — before, what you showed, after, and why. The
        runtime&rsquo;s reasoning, made legible.
      </p>
    </div>
  );

  if (!snapsRes.ok) {
    return (
      <div className="col" style={{ gap: 22 }}>
        {header}
        <LearnerError
          detail="We couldn't reach the runtime to read your snapshots. Your history is preserved on the backend — this view is read-only."
          message={snapsRes.error}
        />
      </div>
    );
  }

  const snapshots = snapsRes.data;
  const graph = graphRes.ok ? graphRes.data : { concepts: [], dependencies: [] };

  const items: TimelineItem[] = snapshots.map((snap: PedagogicalSnapshot) => {
    const decision = (snap.decision ?? {}) as Record<string, unknown>;
    const observation = (snap.observation ?? {}) as Record<string, unknown>;
    const activityType = typeof decision.activity_type === "string" ? decision.activity_type : undefined;
    const rationale = typeof decision.audit_rationale === "string" ? decision.audit_rationale : undefined;
    const masteryDelta = typeof decision.mastery_delta === "number" ? decision.mastery_delta : undefined;

    const obsBits: string[] = [];
    if (typeof observation.success === "boolean") obsBits.push(observation.success ? "success" : "miss");
    if (typeof observation.score === "number") obsBits.push(`score ${observation.score.toFixed(2)}`);
    if (typeof observation.error_type === "string" && observation.error_type)
      obsBits.push(`error: ${observation.error_type}`);

    return {
      id: snap.id,
      title: `${conceptName(graph.concepts, snap.concept_id)}${activityType ? ` · ${activityType.replace(/_/g, " ").toLowerCase()}` : ""}`,
      when: fmtDate(snap.created_at, true),
      before: masteryLine(snap.before),
      observation: obsBits.length ? obsBits.join(" · ") : undefined,
      after: masteryLine(snap.after),
      rationale: (
        <span>
          {rationale ?? "runtime decision recorded"}
          {masteryDelta !== undefined ? (
            <>
              {" "}
              <span className="mono quiet">(Δ mastery {masteryDelta >= 0 ? "+" : ""}{masteryDelta.toFixed(3)})</span>
            </>
          ) : null}
        </span>
      ),
      source: "runtime",
    };
  });

  return (
    <div className="col" style={{ gap: 22 }}>
      {header}
      {items.length === 0 ? (
        <LearnerEmpty kicker="No snapshots yet">
          The timeline starts with your first attempt on{" "}
          <Link href="/learner" style={{ color: "var(--accent)" }}>Now</Link>. Each step the
          runtime takes — before, what you showed, after, and why — lands here.
        </LearnerEmpty>
      ) : (
        <Timeline items={items} />
      )}
    </div>
  );
}
