import Link from "next/link";
import { loadTenantContext } from "@/lib/tenant-context";
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
  return `maîtrise ${fmtPct(st.mastery)} · rétention ${fmtPct(st.retention)} · ${st.card_state}`;
}

export default async function HistoryScreen() {
  const learner = await activeLearner();
  const [ctx, snapsRes] = await Promise.all([
    loadTenantContext(),
    loadSnapshots(learner.id),
  ]);

  const header = (
    <div className="col" style={{ gap: 8 }}>
      <span className="kicker">Historique</span>
      <h1 className="standfirst">Chaque étape parcourue par le runtime avec vous.</h1>
      <p className="soft" style={{ maxWidth: "62ch", fontSize: 15, lineHeight: 1.6 }}>
        Instantanés pédagogiques — avant, ce que vous avez montré, après, et pourquoi. Le
        raisonnement du runtime, rendu lisible.
      </p>
    </div>
  );

  if (!snapsRes.ok) {
    return (
      <div className="col" style={{ gap: 22 }}>
        {header}
        <LearnerError
          detail="Nous n'avons pas pu joindre le runtime pour lire vos instantanés. Votre historique est conservé sur le backend — cette vue est en lecture seule."
          message={snapsRes.error}
        />
      </div>
    );
  }

  const snapshots = snapsRes.data;
  const domainId = snapshots[0]?.domain_id || ctx.primaryDomain?.id || "";
  const graphRes = await loadDomainGraph(domainId);
  const graph = graphRes.ok ? graphRes.data : { concepts: [], dependencies: [] };

  const items: TimelineItem[] = snapshots.map((snap: PedagogicalSnapshot) => {
    const decision = (snap.decision ?? {}) as Record<string, unknown>;
    const observation = (snap.observation ?? {}) as Record<string, unknown>;
    const activityType = typeof decision.activity_type === "string" ? decision.activity_type : undefined;
    const rationale = typeof decision.audit_rationale === "string" ? decision.audit_rationale : undefined;
    const masteryDelta = typeof decision.mastery_delta === "number" ? decision.mastery_delta : undefined;

    const obsBits: string[] = [];
    if (typeof observation.success === "boolean") obsBits.push(observation.success ? "réussite" : "échec");
    if (typeof observation.score === "number") obsBits.push(`score ${observation.score.toFixed(2)}`);
    if (typeof observation.error_type === "string" && observation.error_type)
      obsBits.push(`erreur : ${observation.error_type}`);

    return {
      id: snap.id,
      title: `${conceptName(graph.concepts, snap.concept_id)}${activityType ? ` · ${activityType.replace(/_/g, " ").toLowerCase()}` : ""}`,
      when: fmtDate(snap.created_at, true),
      before: masteryLine(snap.before),
      observation: obsBits.length ? obsBits.join(" · ") : undefined,
      after: masteryLine(snap.after),
      rationale: (
        <span>
          {rationale ?? "décision du runtime enregistrée"}
          {masteryDelta !== undefined ? (
            <>
              {" "}
              <span className="mono quiet">(Δ maîtrise {masteryDelta >= 0 ? "+" : ""}{masteryDelta.toFixed(3)})</span>
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
        <LearnerEmpty kicker="Aucun instantané pour l'instant">
          La chronologie commence avec votre première tentative sur{" "}
          <Link href="/learner" style={{ color: "var(--accent)" }}>Maintenant</Link>. Chaque étape que
          le runtime parcourt — avant, ce que vous avez montré, après, et pourquoi — atterrit ici.
        </LearnerEmpty>
      ) : (
        <Timeline items={items} />
      )}
    </div>
  );
}
