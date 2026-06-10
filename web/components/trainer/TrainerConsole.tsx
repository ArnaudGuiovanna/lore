"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { Alert, Concept, Dependency, Syllabus } from "@/lib/types";
import { Panel } from "@/components/ui/Panel";
import { Card } from "@/components/ui/Card";
import { SourceMark } from "@/components/runtime/SourceMark";
import { AuthorSyllabus } from "./AuthorSyllabus";
import { AttachCohort } from "./AttachCohort";
import { Versions } from "./Versions";
import { Alerts } from "./Alerts";
import { Inspection } from "./Inspection";
import { Intervention } from "./Intervention";
import { CohortHealth } from "./CohortHealth";
import { PathEditor } from "./PathEditor";
import { Evaluations } from "./Evaluations";
import { asTrainerSection, TRAINER_DEFAULT_SECTION, type TrainerSection as Section } from "./sections";
import type { CohortAnalytics, LearnerRow, SeedSyllabus } from "./types";
import t from "./trainer.module.css";

// A syllabus the trainer authored or that ships seeded/bound, tracked client-side
// (the backend exposes no list endpoint for syllabi).
interface SylCard {
  id: string;
  title: string;
  description: string;
  objectives: string[];
  bound: boolean;
  version: number;
}

export function TrainerConsole({
  cohortName,
  cohortId,
  domainName,
  domainId,
  concepts,
  dependencies,
  liveSyllabus,
  analytics,
  alerts,
  learners,
  backendOk,
}: {
  cohortName: string;
  cohortId: string;
  domainName: string;
  domainId: string;
  concepts: Concept[];
  dependencies: Dependency[];
  liveSyllabus: SeedSyllabus;
  analytics: CohortAnalytics | null;
  alerts: Alert[];
  learners: LearnerRow[];
  backendOk: boolean;
}) {
  // The rendered section is addressable: /trainer?section=… (UX-01). The URL
  // is the shared source of truth with the lateral AppNav; programmatic jumps
  // update it shallowly so links stay shareable without refetching the page.
  const urlSection = asTrainerSection(useSearchParams().get("section"));
  const [section, setSection] = useState<Section>(urlSection);
  useEffect(() => {
    setSection(urlSection);
  }, [urlSection]);
  function go(next: Section) {
    setSection(next);
    window.history.replaceState(
      null,
      "",
      next === TRAINER_DEFAULT_SECTION ? "/trainer" : `/trainer?section=${next}`
    );
  }
  const [authored, setAuthored] = useState<SylCard[]>([]);
  // Which syllabus the Attach screen targets (defaults to the live/bound one).
  const [activeSyllabus, setActiveSyllabus] = useState<SeedSyllabus>(liveSyllabus);

  const learnerName = useMemo(() => {
    const m = new Map(learners.map((l) => [l.id, l.name]));
    return (id: string) => m.get(id) ?? id;
  }, [learners]);

  const openAlerts = alerts.filter((a) => a.status !== "RESOLVED").length;

  const liveCard: SylCard = {
    id: liveSyllabus.id,
    title: liveSyllabus.title,
    description: liveSyllabus.description,
    objectives: liveSyllabus.objectives,
    bound: true,
    version: liveSyllabus.version,
  };
  const allCards: SylCard[] = [liveCard, ...authored];

  function onAuthored(s: Syllabus, objectives: string[]) {
    const card: SylCard = {
      id: s.id,
      title: s.title,
      description: s.description,
      objectives,
      bound: false,
      version: 1,
    };
    setAuthored((a) => [...a, card]);
    setActiveSyllabus({
      id: s.id,
      title: s.title,
      description: s.description,
      objectives,
      outcomes: [],
      version: 1,
      bound: false,
      createdAt: s.created_at,
    });
    go("attach");
  }

  const conceptName = (id: string) => concepts.find((c) => c.id === id)?.name ?? id;

  return (
    <div>
      <div className="spread" style={{ flexWrap: "wrap", gap: 10, alignItems: "center" }}>
        <p className="kicker" style={{ margin: 0 }}>Console formateur · {cohortName}</p>
        {/* Alert pressure stays visible from every section (the nav moved to AppNav). */}
        {openAlerts > 0 && section !== "alerts" ? (
          <button
            type="button"
            className="pill"
            onClick={() => go("alerts")}
            style={{
              cursor: "pointer",
              color: "var(--alarm)",
              background: "var(--alarm-soft)",
              borderColor: "rgba(124, 37, 49, 0.28)",
            }}
          >
            {openAlerts} alerte{openAlerts > 1 ? "s" : ""} ouverte{openAlerts > 1 ? "s" : ""} →
          </button>
        ) : null}
      </div>
      <h1 className="standfirst" style={{ marginTop: 8, marginBottom: 6 }}>
        Vous ne construisez pas de cours — vous rédigez un syllabus.
      </h1>
      <p className="soft" style={{ maxWidth: "62ch", marginBottom: backendOk ? 20 : 14 }}>
        Déclarez l&apos;intention. Rattachez un groupe. Le runtime planifie ; le LLM rédige.
      </p>

      {!backendOk ? (
        <div className={t.degraded} role="status">
          <span className="mark alarm">dégradé</span>
          <span>
            Certaines lectures du runtime n&apos;ont pas répondu — les analytics et les alertes ci-dessous peuvent
            être incomplètes. La rédaction et le rattachement fonctionnent toujours ; rien n&apos;est inventé pour
            combler le manque.
          </span>
        </div>
      ) : null}

      {section === "design" ? (
        <div className="col" style={{ gap: 22 }}>
          {/* Primary action first (UX hierarchy): your syllabi + "Rédiger" above
              the fold; the framing manifesto follows. */}
          <Panel
            kicker="Syllabus"
            title="Vos syllabus"
            aside={
              <button type="button" className="btn primary" onClick={() => go("author")}>
                + Rédiger un nouveau syllabus
              </button>
            }
          >
            {concepts.length === 0 ? (
              <p className="quiet mono" style={{ fontSize: 12, marginBottom: 14 }}>
                Le graphe {domainName} n&apos;a renvoyé aucun concept — la rédaction sur le DAG est suspendue
                jusqu&apos;à sa résolution. Vos syllabus existants ne sont pas affectés.
              </p>
            ) : null}
            <div className={t.sylGrid}>
              {allCards.map((c) => (
                <Card key={c.id} className={t.sylCard}>
                  <div className="spread" style={{ alignItems: "flex-start" }}>
                    <strong style={{ fontFamily: "var(--display)", fontSize: 18 }}>{c.title}</strong>
                    <span className={`pill ${c.bound ? "on" : ""}`}>{c.bound ? "actif" : "brouillon"}</span>
                  </div>
                  <p className="soft" style={{ fontSize: 14, margin: 0 }}>{c.description || "—"}</p>
                  <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                    {c.objectives.map((o) => (
                      <span key={o} className="pill" style={{ fontSize: 10 }}>{conceptName(o)}</span>
                    ))}
                  </div>
                  <div className={t.sylBind}>
                    <span className="mono">{c.id.slice(0, 8)} · v{c.version}</span>
                    {c.bound ? (
                      <>
                        <span>→</span>
                        <span style={{ color: "var(--accent)" }}>{cohortName}</span>
                        <SourceMark source="runtime" label="rattachement actif" />
                      </>
                    ) : (
                      <button
                        type="button"
                        className="btn ghost"
                        style={{ padding: "4px 10px" }}
                        onClick={() => {
                          setActiveSyllabus({
                            id: c.id,
                            title: c.title,
                            description: c.description,
                            objectives: c.objectives,
                            outcomes: [],
                            version: c.version,
                            bound: false,
                          });
                          go("attach");
                        }}
                      >
                        Rattacher un groupe →
                      </button>
                    )}
                  </div>
                  {c.bound ? (
                    <button
                      type="button"
                      className="btn ghost"
                      style={{ alignSelf: "flex-start", padding: "4px 10px" }}
                      onClick={() => go("versions")}
                    >
                      Gérer / historique des versions →
                    </button>
                  ) : null}
                </Card>
              ))}
            </div>
          </Panel>

          <Panel kicker="Concevoir l'apprentissage" title="L'intention, pas les artefacts">
            <p className="prose" style={{ fontSize: 18, marginBottom: 14 }}>
              Vous ne construisez pas de cours. Vous concevez l&apos;apprentissage : un <strong>syllabus</strong>
              d&apos;intention — titre, description, objectifs, acquis mesurables. Pas de constructeur de cours,
              pas d&apos;import de ressources, pas d&apos;ordonnancement manuel.
            </p>
            <div className={t.frameNeg}>
              <span className={t.negChip}><s>construire des cours</s></span>
              <span className={t.negChip}><s>importer des ressources</s></span>
              <span className={t.negChip}><s>ordonner les activités</s></span>
              <span className={t.negChip}><s>modifier la maîtrise</s></span>
            </div>
          </Panel>
        </div>
      ) : null}

      {section === "author" ? (
        <AuthorSyllabus
          concepts={concepts}
          heading="Rédiger un syllabus"
          intro={`Déclarez ce que ce groupe doit durablement être capable de faire. Les objectifs sont des concepts du graphe ${domainName} — les cibles de planification du runtime.`}
          onCreated={(s, objectives) => onAuthored(s, objectives)}
        />
      ) : null}

      {section === "attach" ? (
        <AttachCohort
          syllabusId={activeSyllabus.id}
          syllabusTitle={activeSyllabus.title}
          objectiveIds={activeSyllabus.objectives.length ? activeSyllabus.objectives : liveSyllabus.objectives}
          cohortId={cohortId}
          cohortName={cohortName}
          learnerCount={learners.length}
          concepts={concepts}
          dependencies={dependencies}
        />
      ) : null}

      {section === "path" ? (
        <PathEditor
          syllabusId={liveSyllabus.id}
          syllabusTitle={liveSyllabus.title}
          concepts={concepts}
        />
      ) : null}

      {section === "evaluations" ? (
        <Evaluations
          cohortId={cohortId}
          cohortName={cohortName}
          domainId={domainId}
          concepts={concepts}
          learnerName={learnerName}
        />
      ) : null}

      {section === "versions" ? (
        <Versions
          live={liveSyllabus}
          cohortName={cohortName}
          cohortId={cohortId}
          learnerCount={learners.length}
          concepts={concepts}
          dependencies={dependencies}
        />
      ) : null}

      {section === "health" ? (
        <CohortHealth
          analytics={analytics}
          learners={learners}
          cohortName={cohortName}
          cohortId={cohortId}
          onInspect={() => go("inspection")}
        />
      ) : null}

      {section === "alerts" ? <Alerts initial={alerts} learnerName={learnerName} /> : null}

      {section === "inspection" ? (
        <Inspection learners={learners} onIntervene={() => go("intervention")} />
      ) : null}

      {section === "intervention" ? <Intervention learners={learners} /> : null}
    </div>
  );
}
