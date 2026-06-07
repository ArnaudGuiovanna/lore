import Link from "next/link";
import { seed } from "@/lib/config";
import { Metric } from "@/components/ui/Metric";
import { Pill } from "@/components/Mark";
import { fmtDate, fmtPct } from "@/lib/format";
import {
  activeLearner,
  conceptName,
  loadDomainGraph,
  loadStates,
} from "@/components/learner/data";
import { LearnerError, LearnerEmpty } from "@/components/learner/LearnerStatus";
import { BOUND_SYLLABUS_TITLE, prerequisites, servesTrace } from "@/components/learner/lineage";
import type { LearnerState } from "@/lib/types";

export const dynamic = "force-dynamic";

// Calibration: agreement between confidence and demonstrated mastery. Honest gap,
// not a vanity bar. |confidence - mastery| small = well-calibrated.
function calibration(st: LearnerState): { gap: number; label: string } {
  const gap = Math.abs(st.confidence - st.mastery);
  const label = gap < 0.12 ? "calibrated" : st.confidence > st.mastery ? "over-confident" : "under-confident";
  return { gap, label };
}

export default async function ProgressScreen() {
  const s = seed();
  const learner = await activeLearner();
  const [statesRes, graphRes] = await Promise.all([
    loadStates(learner.id),
    loadDomainGraph(s.domainId),
  ]);

  const header = (
    <div className="col" style={{ gap: 8 }}>
      <span className="kicker">Progress</span>
      <h1 className="standfirst">Your path — and where you stand on it.</h1>
      <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
        <span className="mono quiet" style={{ fontSize: 11 }}>
          generated from the syllabus of {s.cohortName} · {BOUND_SYLLABUS_TITLE}
        </span>
      </div>
      <p className="soft" style={{ maxWidth: "62ch", fontSize: 14, lineHeight: 1.6 }}>
        Honest signals only — mastery, retention and calibration as the runtime
        scores them. No vanity bars.
      </p>
    </div>
  );

  if (!statesRes.ok) {
    return (
      <div className="col" style={{ gap: 22 }}>
        {header}
        <LearnerError
          detail="We couldn't reach the runtime to read your state, so there are no signals to show. We won't invent any."
          message={statesRes.error}
        />
      </div>
    );
  }

  const states = statesRes.data;
  const graph = graphRes.ok ? graphRes.data : { concepts: [], dependencies: [] };
  const sorted = [...states].sort((a, b) => a.mastery - b.mastery);

  return (
    <div className="col" style={{ gap: 22 }}>
      {header}

      {sorted.length === 0 ? (
        <LearnerEmpty kicker="No signals yet">
          The runtime hasn&rsquo;t scored any concepts for you yet. Take your first
          step on <Link href="/learner" style={{ color: "var(--accent)" }}>Now</Link> and
          your mastery, retention and calibration will appear here.
        </LearnerEmpty>
      ) : (
        <div className="grid" style={{ gridTemplateColumns: "1fr", gap: 14 }}>
          {sorted.map((st) => {
            const name = conceptName(graph.concepts, st.concept_id);
            const cal = calibration(st);
            const serves = servesTrace(graph.dependencies, graph.concepts, st.concept_id);
            const gates = prerequisites(graph.dependencies, st.concept_id).map((id) => ({
              id,
              name: conceptName(graph.concepts, id),
              mastered: (states.find((x) => x.concept_id === id)?.mastery ?? 0) >= 0.8,
            }));
            const locked = gates.filter((g) => !g.mastered);
            return (
              <section key={st.concept_id} className="panel col" style={{ gap: 14 }}>
                <div className="spread" style={{ flexWrap: "wrap", gap: 10, alignItems: "baseline" }}>
                  <h2 style={{ fontSize: 20 }}>{name}</h2>
                  <Pill on={st.card_state === "review"}>{st.card_state}</Pill>
                </div>
                <p className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "baseline", margin: 0 }}>
                  <span className="kicker" style={{ fontSize: 9 }}>
                    serves
                  </span>
                  <Pill on={serves.kind === "objective"}>{serves.pill}</Pill>
                  <span className="soft" style={{ fontSize: 13, fontStyle: "italic" }}>
                    → {serves.note}
                  </span>
                </p>
                <div className="row" style={{ gap: 24, flexWrap: "wrap" }}>
                  <Metric
                    label="mastery"
                    value={fmtPct(st.mastery)}
                    tone={st.mastery >= 0.8 ? "accent" : "ink"}
                  />
                  <Metric
                    label="retention"
                    value={fmtPct(st.retention)}
                    tone={st.retention < 0.5 ? "amber" : "ink"}
                  />
                  <Metric
                    label="calibration"
                    value={cal.label}
                    hint={`gap ${cal.gap.toFixed(2)}`}
                    tone={cal.label === "calibrated" ? "accent" : "amber"}
                  />
                  <Metric label="reps · lapses" value={`${st.reps} · ${st.lapses}`} />
                  <Metric label="next review" value={fmtDate(st.due_at)} />
                </div>
                {locked.length ? (
                  <p className="soft" style={{ fontSize: 13 }}>
                    Runtime-added prerequisite{locked.length > 1 ? "s" : ""}:{" "}
                    {locked.map((g) => (
                      <Pill key={g.id}>{g.name} · locked</Pill>
                    ))}
                  </p>
                ) : null}
              </section>
            );
          })}
        </div>
      )}

      {sorted.length ? (
      <p className="soft" style={{ fontSize: 13, borderTop: "1px solid var(--line)", paddingTop: 14 }}>
        Some work is retention upkeep the runtime scheduled outside any single
        objective — kept honest rather than hidden.
      </p>
      ) : null}
    </div>
  );
}
