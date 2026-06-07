"use client";

import { useState } from "react";
import type { Concept, Dependency, SyllabusBinding } from "@/lib/types";
import { Panel } from "@/components/ui/Panel";
import { Card } from "@/components/ui/Card";
import { SourceMark } from "@/components/runtime/SourceMark";
import { StreamReader } from "@/components/runtime/StreamReader";
import { orderConcepts } from "./order";
import type { OrderedConcept } from "./order";
import t from "./trainer.module.css";

// Attach a cohort = create a binding (target_type COHORT, adaptation_mode GUIDED). The
// binding ACTIVATES generation: the runtime orders the objectives along the DAG
// (runtime-decided) and the LLM frames each activity (llm-generated).
export function AttachCohort({
  syllabusId,
  syllabusTitle,
  objectiveIds,
  cohortId,
  cohortName,
  learnerCount,
  concepts,
  dependencies,
}: {
  syllabusId: string;
  syllabusTitle: string;
  objectiveIds: string[];
  cohortId: string;
  cohortName: string;
  learnerCount: number;
  concepts: Concept[];
  dependencies: Dependency[];
}) {
  const [mode, setMode] = useState<"GUIDED" | "SELF_DIRECTED">("GUIDED");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [binding, setBinding] = useState<SyllabusBinding | null>(null);

  const ordered: OrderedConcept[] = orderConcepts(objectiveIds, concepts, dependencies);

  async function bind() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/syllabi/bind", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          syllabusId,
          target_type: "COHORT",
          target_id: cohortId,
          adaptation_mode: mode,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? `HTTP ${res.status}`);
        return;
      }
      setBinding(data as SyllabusBinding);
    } catch (e) {
      setError(e instanceof Error ? e.message : "network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="col" style={{ gap: 24 }}>
      <div className={t.two}>
        <Panel kicker="Attach a cohort" title="The binding fires — the parcours materializes">
          <p className="soft" style={{ marginTop: -6, marginBottom: 18, maxWidth: "62ch" }}>
            You don&apos;t order activities. You bind <strong>{syllabusTitle}</strong> to a cohort. The runtime
            owns progression from there.
          </p>

          <Card style={{ marginBottom: 16, borderColor: "rgba(42,79,62,.3)", background: "var(--accent-soft)" }}>
            <div className="spread">
              <div className="col" style={{ gap: 3 }}>
                <span className="kicker">target · COHORT</span>
                <strong style={{ fontSize: 18 }}>{cohortName}</strong>
                <span className="quiet mono" style={{ fontSize: 11 }}>{learnerCount} learners</span>
              </div>
              <span className="pill on">selected</span>
            </div>
          </Card>

          <div className="col" style={{ gap: 8 }}>
            <span className="kicker">adaptation mode</span>
            {(["GUIDED", "SELF_DIRECTED"] as const).map((m) => (
              <button
                key={m}
                type="button"
                className="card"
                style={{
                  textAlign: "left",
                  padding: 14,
                  cursor: "pointer",
                  borderColor: mode === m ? "var(--accent)" : "var(--line)",
                  background: mode === m ? "var(--accent-soft)" : "var(--card)",
                }}
                onClick={() => setMode(m)}
              >
                <div className="spread">
                  <span className="mono" style={{ fontSize: 13, fontWeight: 600 }}>
                    {m}
                    {m === "GUIDED" ? <span className="pill on" style={{ marginLeft: 8 }}>default</span> : null}
                  </span>
                </div>
                <p className="soft" style={{ margin: "6px 0 0", fontSize: 14 }}>
                  {m === "GUIDED"
                    ? "The runtime drives sequencing and pacing against mastery + retention."
                    : "The learner chooses next concepts within the runtime's prerequisite guardrails."}
                </p>
              </button>
            ))}
          </div>

          {error ? (
            <p className="mono" style={{ color: "var(--alarm)", fontSize: 13, marginTop: 16 }}>
              {error}
            </p>
          ) : null}

          <div className="row" style={{ marginTop: 18 }}>
            <button type="button" className="btn primary" disabled={busy || !!binding} onClick={bind}>
              {busy ? "Binding…" : binding ? "Bound ✓" : "Bind & generate parcours"}
            </button>
            <span className="quiet mono" style={{ fontSize: 11 }}>POST /api/syllabi/bind</span>
          </div>
        </Panel>

        <div className={t.sticky}>
          <Panel kicker="What the binding activates" title="Runtime + LLM">
            <p className="soft" style={{ fontSize: 14, marginTop: -4 }}>
              The binding is the only authoritative act here. Once written, the runtime plans the parcours from
              the objectives and the LLM streams each activity&apos;s framing.
            </p>
            <div className="col" style={{ gap: 8, marginTop: 12 }}>
              <SourceMark source="runtime" label="orders concepts" detail="prerequisite-respecting" />
              <SourceMark source="llm" label="frames each activity" detail="from TutorInstruction" />
              <SourceMark source="fallbk" label="instruction-only" detail="if no provider" />
            </div>
            {binding ? (
              <p className="quiet mono" style={{ fontSize: 11, marginTop: 14, wordBreak: "break-all" }}>
                binding {binding.id} · {binding.adaptation_mode}
              </p>
            ) : null}
          </Panel>
        </div>
      </div>

      {binding ? (
        <Panel
          kicker="Generated parcours"
          title="The runtime sequenced these concepts"
          aside={<SourceMark source="runtime" />}
        >
          <p className="soft" style={{ marginTop: -6, marginBottom: 18, maxWidth: "62ch" }}>
            Order is <strong>runtime-decided</strong> along the domain DAG. The per-activity framing is
            <strong> LLM-generated</strong> and disposable — regenerate at will; the runtime owns the order.
          </p>
          <ol className={t.parcours}>
            {ordered.map((o, i) => (
              <li key={o.concept.id} className={t.pstep}>
                <span className={t.pseq}>{i + 1}</span>
                <div className={t.pcard}>
                  <div className={t.pcardTop}>
                    <span className={t.pconcept}>{o.concept.name}</span>
                    <span className="row" style={{ gap: 10 }}>
                      {o.prereqs.length ? (
                        <span className={t.pprereq}>after {o.prereqs.join(", ")}</span>
                      ) : (
                        <span className={t.pprereq}>entry point</span>
                      )}
                      <SourceMark source="runtime" />
                    </span>
                  </div>
                  <div className={t.pbody}>
                    <div className="kicker" style={{ marginBottom: 6 }}>
                      <SourceMark source="llm" label="framing" />
                    </div>
                    <StreamReader
                      text={`We open ${o.concept.name.toLowerCase()} once ${
                        o.prereqs.length ? o.prereqs.join(" and ").toLowerCase() : "the prerequisites"
                      } hold. Expect a short diagnostic, then guided practice calibrated to the cohort's current mastery.`}
                    />
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </Panel>
      ) : null}
    </div>
  );
}
