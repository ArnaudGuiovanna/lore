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
      setRebindError(e instanceof Error ? e.message : "erreur réseau");
    } finally {
      setBusy(false);
    }
  }

  // Diff bound → target for the ReviewState.
  const diffs = rebindTarget
    ? [
        { field: "syllabus rattaché", before: `v${boundVersion.version} · ${boundVersion.id.slice(0, 8)}`, after: `v${rebindTarget.version} · ${rebindTarget.id.slice(0, 8)}` },
        {
          field: "objectifs",
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
        heading={`Dériver la v${latest.version + 1} depuis la v${latest.version}`}
        intro="La modification est en ajout uniquement. L'enregistrement écrit un NOUVEAU syllabus (une nouvelle version) et émet SyllabusCreated. La version actuelle reste identique au bit près et rattachée jusqu'à ce que vous rattachiez à nouveau."
        initialTitle={latest.title}
        initialObjectives={latest.objectives}
        initialOutcomes={latest.outcomes}
        submitLabel={`Enregistrer comme v${latest.version + 1} (dérivation)`}
        versionNote="L'enregistrement n'écrase pas la version actuelle. Il crée un nouveau brouillon non rattaché. Rien ne change pour les apprenants tant que vous ne rattachez pas à nouveau."
        onCreated={(s, objectives, outcomes) => onForked(s, objectives, outcomes)}
      />
    );
  }

  return (
    <div className="col" style={{ gap: 24 }}>
      <Panel
        kicker="Versions · ajout uniquement"
        title="Modifier crée une nouvelle version"
        aside={
          <button type="button" className="btn primary" onClick={() => setForking(true)}>
            Modifier → dériver {`v${latest.version + 1}`}
          </button>
        }
      >
        <p className="soft" style={{ marginTop: -6, marginBottom: 18, maxWidth: "62ch" }}>
          Il n&apos;y a ni écrasement ni champ de version sur l&apos;enregistrement — une «&nbsp;version&nbsp;» est un
          concept produit. Chaque modification est un nouveau syllabus. Le groupe suit la version vers laquelle pointe
          son <strong>rattachement</strong>.
        </p>

        <Timeline
          items={versions.map((v) => ({
            id: v.id,
            title: (
              <span className="row" style={{ gap: 10 }}>
                v{v.version} · {v.title}
                {v.bound ? <span className="pill on">rattachée → {cohortName}</span> : <span className="pill">brouillon · non rattachée</span>}
              </span>
            ),
            when: `${v.id.slice(0, 8)} · ${fmtDate(v.createdAt, true)}`,
            observation: <span>objectifs : {v.objectives.map(conceptName).join(", ") || "—"}</span>,
            rationale: v.bound ? (
              "C'est la version que les apprenants du groupe vivent comme provenance."
            ) : (
              <span className="row" style={{ gap: 10, flexWrap: "wrap" }}>
                N'affecte pas encore les apprenants.
                <button type="button" className="btn" onClick={() => openRebind(v)}>
                  Rattacher {cohortName} → v{v.version}
                </button>
              </span>
            ),
            source: v.bound ? "runtime" : undefined,
            sourceDetail: v.bound ? "rattachement actif" : undefined,
          }))}
        />
      </Panel>

      {binding ? (
        <Panel kicker="Replanifié" title="Le runtime a replanifié à partir de la nouvelle version" aside={<SourceMark source="runtime" />}>
          <p className="soft" style={{ marginTop: -6, marginBottom: 16, maxWidth: "62ch" }}>
            <strong>SyllabusBound</strong> + <strong>ParcoursReplanRequested</strong> émis. La maîtrise, la rétention
            et les instantanés en cours ont été préservés — seule l&apos;intention future a changé.
          </p>
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))" }}>
            {replanOrder.map((o, i) => (
              <Card key={o.concept.id}>
                <span className="kicker">étape {i + 1}</span>
                <div className="mono" style={{ fontSize: 14, fontWeight: 600, margin: "4px 0" }}>{o.concept.name}</div>
                <StreamReader text={`Recadré pour la v${rebindTarget?.version}. ${o.prereqs.length ? `Nécessite ${o.prereqs.join(", ")}.` : "Point d'entrée."}`} />
              </Card>
            ))}
          </div>
        </Panel>
      ) : null}

      <Drawer
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
        kicker="Changement important · humain dans la boucle"
        title={rebindTarget ? `Rattacher ${cohortName} → v${rebindTarget.version}` : "Rattacher"}
      >
        {rebindTarget ? (
          binding ? (
            <div className="col" style={{ gap: 12 }}>
              <SourceMark source="runtime" label="rattaché à nouveau" detail={binding.id.slice(0, 8)} />
              <p className="soft">
                Le groupe suit désormais la v{rebindTarget.version}. La maîtrise, la rétention et les instantanés sont
                intacts — le runtime a uniquement replanifié le parcours futur.
              </p>
              <button type="button" className="btn primary" onClick={() => setReviewOpen(false)}>
                Terminé
              </button>
            </div>
          ) : (
            <ReviewState
              diffs={diffs}
              confirmLabel={`Rattacher à la v${rebindTarget.version}`}
              acknowledgement={`Je comprends que cela replanifie le parcours futur pour ${learnerCount} apprenants. La maîtrise, la rétention et les instantanés en cours sont préservés.`}
              busy={busy}
              error={rebindError ?? undefined}
              onConfirm={confirmRebind}
              onCancel={() => setReviewOpen(false)}
              impact={
                <div className="col" style={{ gap: 10 }}>
                  <span>
                    Affecte <strong>{learnerCount} apprenants</strong>. Le runtime replanifiera le parcours à partir de
                    la v{rebindTarget.version}. La <strong>maîtrise</strong>, la <strong>rétention</strong> et les{" "}
                    <strong>instantanés</strong> en cours sont PRÉSERVÉS — le runtime détient l&apos;état durable ; seule
                    l&apos;intention future change.
                  </span>
                  <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                    <span className="pill on">maîtrise préservée</span>
                    <span className="pill on">rétention préservée</span>
                    <span className="pill on">instantanés préservés</span>
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
