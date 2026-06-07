"use client";

import { useMemo, useState } from "react";
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
import { classNames } from "@/lib/format";
import type { CohortAnalytics, LearnerRow, SeedSyllabus } from "./types";
import t from "./trainer.module.css";

type Section =
  | "design"
  | "author"
  | "attach"
  | "versions"
  | "health"
  | "alerts"
  | "inspection"
  | "intervention";

const SECTIONS: { id: Section; label: string }[] = [
  { id: "design", label: "Design" },
  { id: "author", label: "Author" },
  { id: "attach", label: "Attach cohort" },
  { id: "versions", label: "Versions" },
  { id: "health", label: "Cohort health" },
  { id: "alerts", label: "Alerts" },
  { id: "inspection", label: "Inspection" },
  { id: "intervention", label: "Intervention" },
];

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
  const [section, setSection] = useState<Section>("design");
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
    setSection("attach");
  }

  const conceptName = (id: string) => concepts.find((c) => c.id === id)?.name ?? id;

  return (
    <div>
      <p className="kicker">Trainer console · {cohortName}</p>
      <h1 className="standfirst" style={{ marginTop: 8, marginBottom: 6 }}>
        You don&apos;t build courses — you author a syllabus.
      </h1>
      <p className="soft" style={{ maxWidth: "62ch", marginBottom: backendOk ? 20 : 14 }}>
        Declare intent. Attach a cohort. The runtime plans; the LLM writes.
      </p>

      {!backendOk ? (
        <div className={t.degraded} role="status">
          <span className="mark alarm">degraded</span>
          <span>
            Some runtime reads didn&apos;t answer — analytics and alerts may be incomplete below. Authoring and
            binding still work; nothing shown is fabricated to fill the gap.
          </span>
        </div>
      ) : null}

      <nav className={t.nav} aria-label="Trainer sections">
        {SECTIONS.map((sx) => (
          <button
            key={sx.id}
            type="button"
            className={classNames(t.navBtn, section === sx.id && t.navOn)}
            aria-current={section === sx.id ? "page" : undefined}
            onClick={() => setSection(sx.id)}
          >
            {sx.label}
            {sx.id === "alerts" && openAlerts > 0 ? <span className={t.navCount}>{openAlerts}</span> : null}
          </button>
        ))}
      </nav>

      {section === "design" ? (
        <div className="col" style={{ gap: 22 }}>
          <Panel kicker="Design the learning" title="Intent, not artefacts">
            <p className="prose" style={{ fontSize: 18, marginBottom: 14 }}>
              You don&apos;t build courses. You design the learning: a <strong>syllabus</strong> of intent —
              title, description, objectives, measurable outcomes. No course builder, no resource uploads, no
              manual ordering.
            </p>
            <div className={t.frameNeg}>
              <span className={t.negChip}><s>build courses</s></span>
              <span className={t.negChip}><s>upload resources</s></span>
              <span className={t.negChip}><s>order activities</s></span>
              <span className={t.negChip}><s>edit mastery</s></span>
            </div>
          </Panel>

          <Panel
            kicker="Syllabi"
            title="Your syllabi"
            aside={
              <button type="button" className="btn primary" onClick={() => setSection("author")}>
                + Author a new syllabus
              </button>
            }
          >
            {concepts.length === 0 ? (
              <p className="quiet mono" style={{ fontSize: 12, marginBottom: 14 }}>
                The {domainName} graph returned no concepts — authoring against the DAG is paused until it
                resolves. Your existing syllabi are unaffected.
              </p>
            ) : null}
            <div className={t.sylGrid}>
              {allCards.map((c) => (
                <Card key={c.id} className={t.sylCard}>
                  <div className="spread" style={{ alignItems: "flex-start" }}>
                    <strong style={{ fontFamily: "var(--display)", fontSize: 18 }}>{c.title}</strong>
                    <span className={`pill ${c.bound ? "on" : ""}`}>{c.bound ? "live" : "draft"}</span>
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
                        <SourceMark source="runtime" label="binding active" />
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
                          setSection("attach");
                        }}
                      >
                        Attach cohort →
                      </button>
                    )}
                  </div>
                  {c.bound ? (
                    <button
                      type="button"
                      className="btn ghost"
                      style={{ alignSelf: "flex-start", padding: "4px 10px" }}
                      onClick={() => setSection("versions")}
                    >
                      Manage / version history →
                    </button>
                  ) : null}
                </Card>
              ))}
            </div>
          </Panel>
        </div>
      ) : null}

      {section === "author" ? (
        <AuthorSyllabus
          concepts={concepts}
          heading="Author a syllabus"
          intro={`Declare what this cohort should durably be able to do. Objectives are concepts from the ${domainName} graph — the runtime's planning targets.`}
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
          onInspect={() => setSection("inspection")}
        />
      ) : null}

      {section === "alerts" ? <Alerts initial={alerts} learnerName={learnerName} /> : null}

      {section === "inspection" ? (
        <Inspection learners={learners} onIntervene={() => setSection("intervention")} />
      ) : null}

      {section === "intervention" ? <Intervention learners={learners} /> : null}
    </div>
  );
}
