"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Concept, CourseModule } from "@/lib/types";
import { Panel } from "@/components/ui/Panel";
import { ErrorState, LoadingState } from "@/components/ui/States";
import t from "./trainer.module.css";

// Parcours (B-24) — the trainer sequences the active syllabus into ordered
// modules over the domain DAG. The runtime keeps choosing each activity; the
// modules only fix the frame (concepts allowed, prerequisites, mastery bar).
export function PathEditor({
  syllabusId,
  syllabusTitle,
  concepts,
}: {
  syllabusId: string;
  syllabusTitle: string;
  concepts: Concept[];
}) {
  const [modules, setModules] = useState<CourseModule[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  // "" = automatic position (max+1) — the trainer can still type an explicit one.
  const [positionRaw, setPositionRaw] = useState("");
  const [conceptIds, setConceptIds] = useState<string[]>([]);
  const [prereqIds, setPrereqIds] = useState<string[]>([]);
  const [mastery, setMastery] = useState("0.85");

  const refresh = useCallback(async () => {
    if (!syllabusId) {
      setModules([]);
      return;
    }
    setLoadError(null);
    try {
      const res = await fetch(`/api/trainer/modules?syllabusId=${encodeURIComponent(syllabusId)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setModules(((await res.json()) as CourseModule[]) ?? []);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "chargement impossible");
      setModules([]);
    }
  }, [syllabusId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const list = modules ?? [];
  const nextPosition = list.length ? Math.max(...list.map((m) => m.position)) + 1 : 1;
  const position = positionRaw.trim() === "" ? nextPosition : Number(positionRaw);
  // Prerequisites must be modules of STRICTLY lower position (backend invariant:
  // that single rule keeps the module graph acyclic).
  const prereqCandidates = list.filter((m) => m.position < position);

  // Keep the checked prerequisites consistent when the position changes.
  useEffect(() => {
    setPrereqIds((ids) => ids.filter((id) => prereqCandidates.some((m) => m.id === id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position, modules]);

  const conceptById = useMemo(() => new Map(concepts.map((c) => [c.id, c])), [concepts]);
  const conceptName = (id: string) => conceptById.get(id)?.name ?? id;
  const moduleTitle = (id: string) => list.find((m) => m.id === id)?.title ?? id.slice(0, 8);
  const availableConcepts = concepts.filter((c) => !conceptIds.includes(c.id));

  const masteryNum = Number(mastery.replace(",", "."));
  const valid =
    title.trim().length > 0 &&
    conceptIds.length > 0 &&
    Number.isFinite(position) &&
    position >= 0 &&
    Number.isFinite(masteryNum) &&
    masteryNum > 0 &&
    masteryNum <= 1;

  async function create() {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/trainer/modules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          syllabusId,
          title: title.trim(),
          description: description.trim(),
          position,
          concept_ids: conceptIds,
          prerequisite_ids: prereqIds,
          required_mastery: masteryNum,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data?.error ?? `HTTP ${res.status}`);
        return;
      }
      setTitle("");
      setDescription("");
      setPositionRaw("");
      setConceptIds([]);
      setPrereqIds([]);
      setMastery("0.85");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "erreur réseau");
    } finally {
      setBusy(false);
    }
  }

  async function archive(id: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/trainer/modules/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data?.error ?? `HTTP ${res.status}`);
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="col" style={{ gap: 22 }}>
      <Panel kicker="Parcours" title={`Modules de « ${syllabusTitle} »`}>
        <p className="soft" style={{ marginTop: -6, marginBottom: 16, maxWidth: "62ch" }}>
          Séquencez le syllabus en modules ordonnés sur le DAG de concepts. Le runtime ne planifie
          que dans les modules débloqués de l&apos;apprenant ; un module se termine par la preuve
          (maîtrise mesurée), jamais par un clic. Sans module, le runtime pilote librement.
        </p>
        {modules === null ? (
          <LoadingState label="Chargement des modules…" />
        ) : loadError ? (
          <ErrorState
            kicker="La liste des modules n'a pas répondu"
            detail="Les modules persistés n'ont pas pu être lus — rien n'est inventé pour combler le manque."
            message={loadError}
            action={
              <button type="button" className="btn" onClick={() => void refresh()}>
                ↺ réessayer
              </button>
            }
          />
        ) : list.length === 0 ? (
          <p className="quiet mono" style={{ fontSize: 12 }}>
            Aucun module — le runtime pilote librement. Créez le premier ci-dessous.
          </p>
        ) : (
          <div className="col" style={{ gap: 12 }}>
            {list.map((m) => (
              <div key={m.id} className="col" style={{ gap: 8, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
                <div className="spread" style={{ gap: 10, flexWrap: "wrap", alignItems: "baseline" }}>
                  <div className="row" style={{ gap: 10, alignItems: "baseline" }}>
                    <span className="mono quiet" style={{ fontSize: 11 }}>#{m.position}</span>
                    <strong style={{ fontSize: 16 }}>{m.title}</strong>
                  </div>
                  <button
                    type="button"
                    className="btn ghost"
                    style={{ fontSize: 12 }}
                    disabled={busy}
                    onClick={() => void archive(m.id)}
                  >
                    archiver
                  </button>
                </div>
                {m.description ? (
                  <p className="soft" style={{ fontSize: 13, margin: 0, maxWidth: "62ch" }}>{m.description}</p>
                ) : null}
                <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                  {(m.concept_ids ?? []).map((id) => (
                    <span key={id} className="pill" style={{ fontSize: 10 }}>{conceptName(id)}</span>
                  ))}
                </div>
                <span className="mono quiet" style={{ fontSize: 11 }}>
                  seuil {Math.round(m.required_mastery * 100)} %
                  {(m.prerequisite_ids ?? []).length
                    ? ` · prérequis : ${(m.prerequisite_ids ?? []).map(moduleTitle).join(", ")}`
                    : " · aucun prérequis"}
                </span>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel kicker="Nouveau module" title="Ajouter un module au parcours">
        <div className="col" style={{ gap: 18, maxWidth: 640 }}>
          <label className="col" style={{ gap: 8 }}>
            <span className="kicker">Titre *</span>
            <input
              className={t.input}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Fondations de la persistance"
            />
          </label>

          <label className="col" style={{ gap: 8 }}>
            <span className="kicker">Description</span>
            <textarea
              className={t.textarea}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Ce que ce module verrouille avant la suite…"
            />
          </label>

          <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
            <label className="col" style={{ gap: 8 }}>
              <span className="kicker">Position (auto : {nextPosition})</span>
              <input
                className={t.input}
                type="number"
                min={0}
                value={positionRaw}
                onChange={(e) => setPositionRaw(e.target.value)}
                placeholder={String(nextPosition)}
                style={{ width: 120 }}
              />
            </label>
            <label className="col" style={{ gap: 8 }}>
              <span className="kicker">Seuil de maîtrise (0–1)</span>
              <input
                className={t.input}
                value={mastery}
                onChange={(e) => setMastery(e.target.value)}
                placeholder="0.85"
                style={{ width: 120 }}
              />
            </label>
          </div>

          <div className="col" style={{ gap: 8 }}>
            <span className="kicker">Concepts * · depuis le DAG du domaine</span>
            <div className={t.chipField}>
              {conceptIds.length === 0 ? (
                <span className="quiet mono" style={{ fontSize: 12 }}>
                  Choisissez les concepts couverts par ce module.
                </span>
              ) : (
                conceptIds.map((id) => (
                  <span key={id} className={t.objChip}>
                    {conceptName(id)}
                    <button
                      type="button"
                      className={t.objRm}
                      aria-label={`Retirer ${id}`}
                      onClick={() => setConceptIds((ids) => ids.filter((x) => x !== id))}
                    >
                      ×
                    </button>
                  </span>
                ))
              )}
            </div>
            <div className={t.dagSuggest}>
              {availableConcepts.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={t.dagSug}
                  onClick={() => setConceptIds((ids) => [...ids, c.id])}
                >
                  + {c.name}
                </button>
              ))}
            </div>
          </div>

          <div className="col" style={{ gap: 8 }}>
            <span className="kicker">Prérequis · modules de position inférieure</span>
            {prereqCandidates.length === 0 ? (
              <span className="quiet mono" style={{ fontSize: 12 }}>
                Aucun module de position inférieure à {position} — ce module sera débloqué d&apos;emblée.
              </span>
            ) : (
              <div className="col" style={{ gap: 6 }}>
                {prereqCandidates.map((m) => (
                  <label key={m.id} className="row" style={{ gap: 8, alignItems: "center", fontSize: 14 }}>
                    <input
                      type="checkbox"
                      checked={prereqIds.includes(m.id)}
                      onChange={(e) =>
                        setPrereqIds((ids) =>
                          e.target.checked ? [...ids, m.id] : ids.filter((x) => x !== m.id)
                        )
                      }
                    />
                    <span>
                      #{m.position} · {m.title}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {error ? (
            <p className="mono" style={{ color: "var(--alarm)", fontSize: 13, margin: 0 }}>{error}</p>
          ) : null}

          <div className="row">
            <button type="button" className="btn primary" disabled={!valid || busy} onClick={() => void create()}>
              {busy ? "Enregistrement…" : "Créer le module"}
            </button>
            <span className="quiet mono" style={{ fontSize: 11 }}>
              POST /api/trainer/modules
            </span>
          </div>
        </div>
      </Panel>
    </div>
  );
}
