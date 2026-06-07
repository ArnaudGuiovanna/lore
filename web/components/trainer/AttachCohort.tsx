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
      setError(e instanceof Error ? e.message : "erreur réseau");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="col" style={{ gap: 24 }}>
      <div className={t.two}>
        <Panel kicker="Rattacher un groupe" title="Le rattachement se déclenche — le parcours se matérialise">
          <p className="soft" style={{ marginTop: -6, marginBottom: 18, maxWidth: "62ch" }}>
            Vous n&apos;ordonnez pas les activités. Vous rattachez <strong>{syllabusTitle}</strong> à un groupe.
            Le runtime pilote la progression à partir de là.
          </p>

          <Card style={{ marginBottom: 16, borderColor: "rgba(42,79,62,.3)", background: "var(--accent-soft)" }}>
            <div className="spread">
              <div className="col" style={{ gap: 3 }}>
                <span className="kicker">cible · GROUPE</span>
                <strong style={{ fontSize: 18 }}>{cohortName}</strong>
                <span className="quiet mono" style={{ fontSize: 11 }}>{learnerCount} apprenants</span>
              </div>
              <span className="pill on">sélectionné</span>
            </div>
          </Card>

          <div className="col" style={{ gap: 8 }}>
            <span className="kicker">mode d&apos;adaptation</span>
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
                    {m === "GUIDED" ? <span className="pill on" style={{ marginLeft: 8 }}>par défaut</span> : null}
                  </span>
                </div>
                <p className="soft" style={{ margin: "6px 0 0", fontSize: 14 }}>
                  {m === "GUIDED"
                    ? "Le runtime pilote le séquencement et le rythme en fonction de la maîtrise et de la rétention."
                    : "L'apprenant choisit les concepts suivants dans les garde-fous de prérequis du runtime."}
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
              {busy ? "Rattachement…" : binding ? "Rattaché ✓" : "Rattacher & générer le parcours"}
            </button>
            <span className="quiet mono" style={{ fontSize: 11 }}>POST /api/syllabi/bind</span>
          </div>
        </Panel>

        <div className={t.sticky}>
          <Panel kicker="Ce que le rattachement active" title="Runtime + LLM">
            <p className="soft" style={{ fontSize: 14, marginTop: -4 }}>
              Le rattachement est le seul acte qui fait autorité ici. Une fois écrit, le runtime planifie le
              parcours à partir des objectifs et le LLM diffuse le cadrage de chaque activité.
            </p>
            <div className="col" style={{ gap: 8, marginTop: 12 }}>
              <SourceMark source="runtime" label="ordonne les concepts" detail="respect des prérequis" />
              <SourceMark source="llm" label="cadre chaque activité" detail="depuis la TutorInstruction" />
              <SourceMark source="fallbk" label="instruction seule" detail="si aucun fournisseur" />
            </div>
            {binding ? (
              <p className="quiet mono" style={{ fontSize: 11, marginTop: 14, wordBreak: "break-all" }}>
                rattachement {binding.id} · {binding.adaptation_mode}
              </p>
            ) : null}
          </Panel>
        </div>
      </div>

      {binding ? (
        <Panel
          kicker="Parcours généré"
          title="Le runtime a séquencé ces concepts"
          aside={<SourceMark source="runtime" />}
        >
          <p className="soft" style={{ marginTop: -6, marginBottom: 18, maxWidth: "62ch" }}>
            L&apos;ordre est <strong>décidé par le runtime</strong> le long du DAG du domaine. Le cadrage de chaque
            activité est <strong>généré par le LLM</strong> et jetable — régénérez à volonté ; l&apos;ordre
            appartient au runtime.
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
                        <span className={t.pprereq}>après {o.prereqs.join(", ")}</span>
                      ) : (
                        <span className={t.pprereq}>point d&apos;entrée</span>
                      )}
                      <SourceMark source="runtime" />
                    </span>
                  </div>
                  <div className={t.pbody}>
                    <div className="kicker" style={{ marginBottom: 6 }}>
                      <SourceMark source="llm" label="cadrage" />
                    </div>
                    <StreamReader
                      text={`Nous ouvrons ${o.concept.name.toLowerCase()} dès que ${
                        o.prereqs.length ? o.prereqs.join(" et ").toLowerCase() : "les prérequis"
                      } sont acquis. Attendez-vous à un court diagnostic, puis à une pratique guidée calibrée sur la maîtrise actuelle du groupe.`}
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
