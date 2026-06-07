"use client";

import { useState } from "react";
import type { Concept, Dependency, Syllabus, SyllabusBinding } from "@/lib/types";
import { Panel } from "@/components/ui/Panel";
import { Card } from "@/components/ui/Card";
import { Timeline } from "@/components/ui/Timeline";
import { Drawer } from "@/components/ui/Drawer";
import { ReviewState } from "@/components/ui/ReviewState";
import { SourceMark } from "@/components/runtime/SourceMark";
import { StreamReader } from "@/components/runtime/StreamReader";
import { AuthorSyllabus } from "./AuthorSyllabus";
import { fmtDate } from "@/lib/format";
import type { SeedSyllabus } from "./types";
import { orderConcepts } from "./order";

// A version as tracked by the surface (append-only: v1 from seed, v2+ forked locally).
interface Version {
  id: string;
  version: number;
  title: string;
  objectives: string[];
  outcomes: string[];
  bound: boolean;
  createdAt?: string;
}

// VERSIONS: editing forks a new syllabus (POST /api/syllabi → v2, append-only — v1 untouched).
// Rebinding the cohort to v2 is gated behind a ReviewState impact confirmation
// (POST /api/syllabi/bind). The runtime owns durable state — mastery/retention/snapshots
// are preserved; only the forward intent changes.
export function Versions({
  live,
  cohortName,
  cohortId,
  learnerCount,
  concepts,
  dependencies,
}: {
  live: SeedSyllabus;
  cohortName: string;
  cohortId: string;
  learnerCount: number;
  concepts: Concept[];
  dependencies: Dependency[];
}) {
  const conceptName = (id: string) => concepts.find((c) => c.id === id)?.name ?? id;

  const [versions, setVersions] = useState<Version[]>([
    {
      id: live.id,
      version: live.version,
      title: live.title,
      objectives: live.objectives,
      outcomes: live.outcomes,
      bound: true,
      createdAt: live.createdAt,
    },
  ]);
  const [forking, setForking] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [rebindTarget, setRebindTarget] = useState<Version | null>(null);
  const [busy, setBusy] = useState(false);
  const [rebindError, setRebindError] = useState<string | null>(null);
  const [binding, setBinding] = useState<SyllabusBinding | null>(null);

  const boundVersion = versions.find((v) => v.bound)!;
  const latest = versions[versions.length - 1];

  function onForked(s: Syllabus, objectives: string[], outcomes: string[]) {
    const next: Version = {
      id: s.id,
      version: versions.length + 1,
      title: s.title,
      objectives,
      outcomes,
      bound: false,
      createdAt: s.created_at,
    };
    setVersions((vs) => [...vs, next]);
    setForking(false);
  }

  function openRebind(target: Version) {
    setRebindTarget(target);
    setRebindError(null);
    setBinding(null);
    setReviewOpen(true);
  }

  async function confirmRebind() {
    if (!rebindTarget || busy) return;
    setBusy(true);
    setRebindError(null);
    try {
      const res = await fetch("/api/syllabi/bind", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          syllabusId: rebindTarget.id,
          target_type: "COHORT",
          target_id: cohortId,
          adaptation_mode: "GUIDED",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setRebindError(data?.error ?? `HTTP ${res.status}`);
        return;
      }
      setBinding(data as SyllabusBinding);
      setVersions((vs) => vs.map((v) => ({ ...v, bound: v.id === rebindTarget.id })));
    } catch (e) {
      setRebindError(e instanceof Error ? e.message : "network error");
    } finally {
      setBusy(false);
    }
  }

  // Diff bound → target for the ReviewState.
  const diffs = rebindTarget
    ? [
        { field: "bound syllabus", before: `v${boundVersion.version} · ${boundVersion.id.slice(0, 8)}`, after: `v${rebindTarget.version} · ${rebindTarget.id.slice(0, 8)}` },
        {
          field: "objectives",
          before: boundVersion.objectives.map(conceptName).join(", ") || "—",
          after: rebindTarget.objectives.map(conceptName).join(", ") || "—",
        },
      ]
    : [];

  const replanOrder = rebindTarget ? orderConcepts(rebindTarget.objectives, concepts, dependencies) : [];

  if (forking) {
    return (
      <AuthorSyllabus
        concepts={concepts}
        heading={`Fork v${latest.version + 1} from v${latest.version}`}
        intro="Editing is append-only. Saving writes a NEW syllabus record (a new version) and emits SyllabusCreated. The current version stays byte-identical and bound until you rebind."
        initialTitle={latest.title}
        initialObjectives={latest.objectives}
        initialOutcomes={latest.outcomes}
        submitLabel={`Save as v${latest.version + 1} (fork)`}
        versionNote="Saving does not overwrite the current version. It creates a new, unbound draft. Nothing changes for learners until you rebind."
        onCreated={(s, objectives, outcomes) => onForked(s, objectives, outcomes)}
      />
    );
  }

  return (
    <div className="col" style={{ gap: 24 }}>
      <Panel
        kicker="Versions · append-only"
        title="Editing forks a new version"
        aside={
          <button type="button" className="btn primary" onClick={() => setForking(true)}>
            Edit → fork {`v${latest.version + 1}`}
          </button>
        }
      >
        <p className="soft" style={{ marginTop: -6, marginBottom: 18, maxWidth: "62ch" }}>
          There is no overwrite and no version field on the record — a &quot;version&quot; is a product concept. Each
          edit is a fresh syllabus. The cohort follows whichever version its <strong>binding</strong> points to.
        </p>

        <Timeline
          items={versions.map((v) => ({
            id: v.id,
            title: (
              <span className="row" style={{ gap: 10 }}>
                v{v.version} · {v.title}
                {v.bound ? <span className="pill on">bound → {cohortName}</span> : <span className="pill">draft · unbound</span>}
              </span>
            ),
            when: `${v.id.slice(0, 8)} · ${fmtDate(v.createdAt, true)}`,
            observation: <span>objectives: {v.objectives.map(conceptName).join(", ") || "—"}</span>,
            rationale: v.bound ? (
              "This is the version the cohort's learners experience as provenance."
            ) : (
              <span className="row" style={{ gap: 10, flexWrap: "wrap" }}>
                Not affecting learners yet.
                <button type="button" className="btn" onClick={() => openRebind(v)}>
                  Rebind {cohortName} → v{v.version}
                </button>
              </span>
            ),
            source: v.bound ? "runtime" : undefined,
            sourceDetail: v.bound ? "binding active" : undefined,
          }))}
        />
      </Panel>

      {binding ? (
        <Panel kicker="Re-planned" title="The runtime re-planned from the new version" aside={<SourceMark source="runtime" />}>
          <p className="soft" style={{ marginTop: -6, marginBottom: 16, maxWidth: "62ch" }}>
            <strong>SyllabusBound</strong> + <strong>ParcoursReplanRequested</strong> emitted. In-flight mastery,
            retention and snapshots were preserved — only the forward intent changed.
          </p>
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))" }}>
            {replanOrder.map((o, i) => (
              <Card key={o.concept.id}>
                <span className="kicker">step {i + 1}</span>
                <div className="mono" style={{ fontSize: 14, fontWeight: 600, margin: "4px 0" }}>{o.concept.name}</div>
                <StreamReader text={`Reframed for v${rebindTarget?.version}. ${o.prereqs.length ? `Requires ${o.prereqs.join(", ")}.` : "Entry point."}`} />
              </Card>
            ))}
          </div>
        </Panel>
      ) : null}

      <Drawer
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
        kicker="Significant change · human-in-the-loop"
        title={rebindTarget ? `Rebind ${cohortName} → v${rebindTarget.version}` : "Rebind"}
      >
        {rebindTarget ? (
          binding ? (
            <div className="col" style={{ gap: 12 }}>
              <SourceMark source="runtime" label="rebound" detail={binding.id.slice(0, 8)} />
              <p className="soft">
                The cohort now follows v{rebindTarget.version}. Mastery, retention and snapshots are intact — the
                runtime re-planned the forward parcours only.
              </p>
              <button type="button" className="btn primary" onClick={() => setReviewOpen(false)}>
                Done
              </button>
            </div>
          ) : (
            <ReviewState
              diffs={diffs}
              confirmLabel={`Rebind to v${rebindTarget.version}`}
              acknowledgement={`I understand this re-plans the forward parcours for ${learnerCount} learners. In-flight mastery, retention and snapshots are preserved.`}
              busy={busy}
              error={rebindError ?? undefined}
              onConfirm={confirmRebind}
              onCancel={() => setReviewOpen(false)}
              impact={
                <div className="col" style={{ gap: 10 }}>
                  <span>
                    Affects <strong>{learnerCount} learners</strong>. The runtime will re-plan the parcours from
                    v{rebindTarget.version}. In-flight <strong>mastery</strong>, <strong>retention</strong> and{" "}
                    <strong>snapshots</strong> are PRESERVED — the runtime owns durable state; only the forward
                    intent changes.
                  </span>
                  <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                    <span className="pill on">mastery preserved</span>
                    <span className="pill on">retention preserved</span>
                    <span className="pill on">snapshots preserved</span>
                  </div>
                </div>
              }
            />
          )
        ) : null}
      </Drawer>
    </div>
  );
}
