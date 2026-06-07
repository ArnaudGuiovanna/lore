"use client";

import { useState } from "react";
import type { LearnerState, PedagogicalSnapshot } from "@/lib/types";
import { Panel } from "@/components/ui/Panel";
import { Card } from "@/components/ui/Card";
import { Metric } from "@/components/ui/Metric";
import { Timeline } from "@/components/ui/Timeline";
import { SourceMark } from "@/components/runtime/SourceMark";
import { fmtDate, fmtPct } from "@/lib/format";
import type { LearnerRow } from "./types";

function num(v: unknown): number | null {
  return typeof v === "number" && !Number.isNaN(v) ? v : null;
}

// Pull a nested learner-state from a snapshot before/after slot ({ state: {...} }).
function stateOf(slot?: Record<string, unknown>): Partial<LearnerState> | null {
  if (!slot) return null;
  const st = (slot as { state?: unknown }).state;
  return st && typeof st === "object" ? (st as Partial<LearnerState>) : null;
}

function masteryDelta(snap: PedagogicalSnapshot): { from: number | null; to: number | null } {
  return { from: num(stateOf(snap.before)?.mastery), to: num(stateOf(snap.after)?.mastery) };
}

// INSPECTION: a learner's pedagogical snapshots timeline. Every node distinguishes the
// runtime's durable decision (runtime-decided) from any generated framing (llm). The
// trainer reads the evidence; mastery is NEVER hand-edited — the runtime owns it.
export function Inspection({
  learners,
  onIntervene,
}: {
  learners: LearnerRow[];
  onIntervene?: () => void;
}) {
  const [selectedId, setSelectedId] = useState<string>(
    [...learners].sort((a, b) => b.openAlerts - a.openAlerts || (a.avgMastery ?? 1) - (b.avgMastery ?? 1))[0]?.id ??
      learners[0]?.id
  );
  const learner = learners.find((l) => l.id === selectedId) ?? learners[0];

  if (!learner) {
    return (
      <Panel kicker="Inspection" title="Aucun apprenant">
        <p className="quiet mono" style={{ fontSize: 13 }}>Aucun apprenant dans ce groupe.</p>
      </Panel>
    );
  }

  const snaps = [...learner.snapshots].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  return (
    <div className="col" style={{ gap: 20 }}>
      <Panel kicker="Inspection · preuves en lecture seule" title="Le dossier durable d'un apprenant">
        <div className="row" style={{ gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
          {learners.map((l) => (
            <button
              key={l.id}
              type="button"
              className="btn"
              style={{
                borderColor: l.id === selectedId ? "var(--accent)" : "var(--line-2)",
                color: l.id === selectedId ? "var(--accent)" : undefined,
                background: l.id === selectedId ? "var(--accent-soft)" : undefined,
              }}
              onClick={() => setSelectedId(l.id)}
            >
              {l.name}
              {l.openAlerts > 0 ? <span className="pill" style={{ marginLeft: 6 }}>{l.openAlerts}</span> : null}
            </button>
          ))}
        </div>
      </Panel>

      <Panel
        kicker={`Apprenant · ${learner.id}`}
        title={learner.name}
        aside={<SourceMark source="runtime" label="état durable" />}
      >
        <div className="row" style={{ gap: 28, flexWrap: "wrap", marginBottom: 20 }}>
          <Metric label="maîtrise moy." value={fmtPct(learner.avgMastery)} tone={(learner.avgMastery ?? 1) < 0.3 ? "alarm" : "ink"} />
          <Metric label="rétention moy." value={fmtPct(learner.avgRetention)} tone={(learner.avgRetention ?? 1) < 0.6 ? "amber" : "ink"} />
          <Metric label="concepts suivis" value={learner.tracked} />
          <Metric label="ré-apprentissage" value={learner.relearning} tone={learner.relearning ? "alarm" : "ink"} />
          <Metric label="révisions à faire" value={learner.due} tone={learner.due ? "amber" : "ink"} />
          <Metric label="alertes ouvertes" value={learner.openAlerts} tone={learner.openAlerts ? "alarm" : "ink"} />
        </div>

        <Card style={{ background: "var(--amber-soft)", borderColor: "rgba(154,106,22,.35)", marginBottom: 20 }}>
          <div className="spread" style={{ gap: 14, flexWrap: "wrap", alignItems: "center" }}>
            <p className="soft" style={{ margin: 0, color: "var(--amber)", fontSize: 14, maxWidth: "58ch" }}>
              La maîtrise et la rétention sont calculées par le runtime (BKT / FSRS) à partir des interactions. Ce
              sont des preuves, pas des curseurs — aucune modification manuelle. Pour infléchir une trajectoire,
              demandez une action sanctionnée ; le runtime re-dérive l&apos;état à partir du résultat.
            </p>
            {onIntervene ? (
              <button type="button" className="btn" style={{ flex: "0 0 auto" }} onClick={onIntervene}>
                Intervenir →
              </button>
            ) : null}
          </div>
        </Card>

        <p className="kicker" style={{ marginBottom: 14 }}>Instantanés pédagogiques · les plus récents d&apos;abord</p>
        {snaps.length === 0 ? (
          <p className="quiet mono" style={{ fontSize: 13 }}>Aucun instantané enregistré pour l&apos;instant pour {learner.name}.</p>
        ) : (
          <Timeline
            items={snaps.map((snap) => {
              const obs = snap.observation as { success?: boolean; score?: number; error_type?: string } | undefined;
              const decision = snap.decision as { activity_type?: string; mastery_delta?: number; review_due_at?: string } | undefined;
              const { from, to } = masteryDelta(snap);
              const delta = num(decision?.mastery_delta);
              return {
                id: snap.id,
                title: (
                  <span className="row" style={{ gap: 9 }}>
                    {decision?.activity_type ?? "interaction"}
                    {snap.concept_id ? <span className="pill">{snap.concept_id}</span> : null}
                  </span>
                ),
                when: fmtDate(snap.created_at, true),
                before: from !== null ? <span className="mono">maîtrise {from.toFixed(2)}</span> : undefined,
                observation: obs ? (
                  <span className="mono">
                    {obs.success ? "réussite" : "échec"} · score {num(obs.score)?.toFixed(2) ?? "—"}
                    {obs.error_type ? ` · ${obs.error_type}` : ""}
                  </span>
                ) : undefined,
                after:
                  to !== null ? (
                    <span className="mono">
                      maîtrise {to.toFixed(2)}
                      {delta !== null ? (
                        <span style={{ color: delta >= 0 ? "var(--accent)" : "var(--alarm)" }}>
                          {" "}({delta >= 0 ? "+" : ""}{delta.toFixed(2)})
                        </span>
                      ) : null}
                    </span>
                  ) : undefined,
                rationale: decision?.review_due_at
                  ? `Le runtime a programmé la prochaine révision le ${fmtDate(decision.review_due_at, true)}.`
                  : "Le runtime a mis à jour l'état durable à partir de cette interaction.",
                source: "runtime" as const,
                sourceDetail: "BKT / FSRS",
              };
            })}
          />
        )}
      </Panel>
    </div>
  );
}
