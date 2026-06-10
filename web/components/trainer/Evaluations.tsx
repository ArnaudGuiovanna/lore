"use client";

// B-26 — Évaluations (formateur) : banque de questions, devoirs, correction.
// Trois volets sur la même section. Les clés de correction restent côté staff ;
// la note manuelle (0..1) alimente le moteur adaptatif quand le devoir est lié
// à un concept du domaine.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { ErrorState, LoadingState } from "@/components/ui/States";
import type { Assignment, AssignmentSubmission, BankQuestion, Concept, Interaction } from "@/lib/types";

type Volet = "bank" | "assignments" | "grading" | "positioning";

type QuestionRow = BankQuestion & Record<string, unknown>;
type AssignmentRow = Assignment & Record<string, unknown>;

function fmtDate(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" });
}

async function readError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return body.error || `HTTP ${res.status}`;
}

export function Evaluations({
  cohortId,
  cohortName,
  domainId,
  concepts,
  learnerName,
  learners,
}: {
  cohortId: string;
  cohortName: string;
  domainId: string;
  concepts: Concept[];
  learnerName: (id: string) => string;
  learners: { id: string; name: string }[];
}) {
  const [volet, setVolet] = useState<Volet>("bank");
  const conceptName = useCallback(
    (id?: string) => (id ? concepts.find((c) => c.id === id)?.name ?? id : "—"),
    [concepts]
  );

  return (
    <div className="col" style={{ gap: 18 }}>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }} role="tablist" aria-label="Volets des évaluations">
        {(
          [
            ["bank", "Banque de questions"],
            ["assignments", "Devoirs"],
            ["grading", "File de correction"],
            ["positioning", "Positionnement"],
          ] as [Volet, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={volet === id}
            className={`pill ${volet === id ? "on" : ""}`}
            style={{ cursor: "pointer" }}
            onClick={() => setVolet(id)}
            data-testid={`eval-tab-${id}`}
          >
            {label}
          </button>
        ))}
      </div>

      {volet === "bank" ? <QuestionBank concepts={concepts} conceptName={conceptName} /> : null}
      {volet === "assignments" ? (
        <AssignmentsPane
          cohortId={cohortId}
          cohortName={cohortName}
          domainId={domainId}
          concepts={concepts}
          conceptName={conceptName}
        />
      ) : null}
      {volet === "grading" ? (
        <GradingQueue cohortId={cohortId} learnerName={learnerName} conceptName={conceptName} />
      ) : null}
      {volet === "positioning" ? (
        <PositioningPane domainId={domainId} learners={learners} conceptName={conceptName} />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Volet 4 — positionnement initial (B-13, exigence Qualiopi)
// ---------------------------------------------------------------------------

type PositioningRow = Interaction & Record<string, unknown>;

// Nombre d'items de la première évaluation corrigée, lu dans le payload de
// l'interaction (jamais recalculé ici).
function itemCount(payload?: Record<string, unknown>): string {
  if (!payload) return "—";
  const items = payload["items"];
  if (Array.isArray(items)) return String(items.length);
  if (typeof items === "number") return String(items);
  const total = payload["item_count"] ?? payload["total_items"];
  return typeof total === "number" ? String(total) : "—";
}

function PositioningPane({
  domainId,
  learners,
  conceptName,
}: {
  domainId: string;
  learners: { id: string; name: string }[];
  conceptName: (id?: string) => string;
}) {
  const [learnerId, setLearnerId] = useState(learners[0]?.id ?? "");
  const [evidence, setEvidence] = useState<Interaction[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!learnerId) {
      setEvidence([]);
      return;
    }
    setLoadError(null);
    try {
      const res = await fetch(
        `/api/trainer/positioning?learnerId=${encodeURIComponent(learnerId)}&domainId=${encodeURIComponent(domainId)}`
      );
      if (!res.ok) throw new Error(await readError(res));
      setEvidence(((await res.json()) as Interaction[]) ?? []);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "chargement impossible");
      setEvidence([]);
    }
  }, [learnerId, domainId]);

  useEffect(() => {
    setEvidence(null);
    void refresh();
  }, [refresh]);

  const columns: Column<PositioningRow>[] = [
    { key: "created_at", header: "Date", mono: true, render: (r) => <span>{fmtDate(r.created_at)}</span> },
    {
      key: "concept_id",
      header: "Concept",
      render: (r) => <span data-testid="positioning-concept">{conceptName(r.concept_id)}</span>,
    },
    {
      key: "score",
      header: "Score initial",
      align: "right",
      mono: true,
      render: (r) => (
        <span data-testid="positioning-score">{Math.round((Number(r.score) || 0) * 100)}/100</span>
      ),
    },
    {
      key: "items",
      header: "Items",
      align: "right",
      mono: true,
      render: (r) => <span>{itemCount(r.payload)}</span>,
    },
  ];

  return (
    <Panel
      kicker="Positionnement · début de formation"
      title="Le niveau d'entrée, archivé"
      aside={
        <label className="col" style={{ gap: 4 }}>
          <span className="quiet mono" style={{ fontSize: 11 }}>apprenant</span>
          <select
            value={learnerId}
            onChange={(e) => setLearnerId(e.target.value)}
            data-testid="positioning-learner"
          >
            {learners.length === 0 ? <option value="">— aucun apprenant —</option> : null}
            {learners.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        </label>
      }
    >
      <p className="soft" style={{ marginTop: -6, marginBottom: 16, maxWidth: "62ch" }}>
        La première évaluation corrigée par concept — la preuve Qualiopi du positionnement de début de
        formation. Lecture seule : l&apos;évidence est détenue par le runtime, jamais réécrite ici.
      </p>
      {evidence === null ? (
        <LoadingState label="Chargement du positionnement…" />
      ) : loadError && evidence.length === 0 ? (
        <ErrorState
          kicker="Le positionnement n'a pas répondu"
          detail="L'évidence persistée n'a pas pu être lue — rien n'est inventé pour combler le manque."
          message={loadError}
          action={
            <button type="button" className="btn" onClick={() => void refresh()}>↺ réessayer</button>
          }
        />
      ) : (
        <DataTable<PositioningRow>
          columns={columns}
          rows={(evidence as PositioningRow[]) ?? []}
          rowKey={(r) => r.id}
          empty="Aucune évaluation corrigée pour cet apprenant — le positionnement apparaît après sa première évaluation."
        />
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Volet 1 — banque de questions
// ---------------------------------------------------------------------------

function QuestionBank({
  concepts,
  conceptName,
}: {
  concepts: Concept[];
  conceptName: (id?: string) => string;
}) {
  const [questions, setQuestions] = useState<BankQuestion[] | null>(null);
  const [filterConcept, setFilterConcept] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [kind, setKind] = useState<"single_choice" | "short_answer">("single_choice");
  const [prompt, setPrompt] = useState("");
  const [conceptId, setConceptId] = useState("");
  const [points, setPoints] = useState(1);
  const [choices, setChoices] = useState<string[]>(["", ""]);
  const [correctIdx, setCorrectIdx] = useState(0);
  const [expected, setExpected] = useState("");

  const refresh = useCallback(async () => {
    setLoadError(null);
    try {
      const url = filterConcept
        ? `/api/trainer/questions?conceptId=${encodeURIComponent(filterConcept)}`
        : "/api/trainer/questions";
      const res = await fetch(url);
      if (!res.ok) throw new Error(await readError(res));
      setQuestions(((await res.json()) as BankQuestion[]) ?? []);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "chargement impossible");
      setQuestions([]);
    }
  }, [filterConcept]);

  useEffect(() => {
    setQuestions(null);
    void refresh();
  }, [refresh]);

  const create = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      if (!prompt.trim()) {
        setError("l'énoncé est requis");
        return;
      }
      const cleanChoices = choices.map((c) => c.trim());
      if (kind === "single_choice") {
        if (cleanChoices.filter(Boolean).length < 2) {
          setError("un QCM demande au moins deux choix");
          return;
        }
        if (!cleanChoices[correctIdx]) {
          setError("désignez la bonne réponse parmi les choix remplis");
          return;
        }
      } else if (!expected.trim()) {
        setError("une réponse attendue est requise pour la réponse courte");
        return;
      }
      setBusy(true);
      try {
        const payload =
          kind === "single_choice"
            ? {
                kind,
                prompt: prompt.trim(),
                concept_id: conceptId,
                points: Number(points) || 1,
                choices: cleanChoices
                  .map((label, i) => ({ id: `c${i + 1}`, label }))
                  .filter((c) => c.label),
                correct_choice_id: `c${correctIdx + 1}`,
              }
            : {
                kind,
                prompt: prompt.trim(),
                concept_id: conceptId,
                points: Number(points) || 1,
                expected_answer: expected.trim(),
              };
        const res = await fetch("/api/trainer/questions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(await readError(res));
        setPrompt("");
        setChoices(["", ""]);
        setCorrectIdx(0);
        setExpected("");
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "création impossible");
      } finally {
        setBusy(false);
      }
    },
    [kind, prompt, conceptId, points, choices, correctIdx, expected, refresh]
  );

  const archive = useCallback(
    async (id: string) => {
      setBusy(true);
      try {
        await fetch(`/api/trainer/questions/${encodeURIComponent(id)}`, { method: "DELETE" });
        await refresh();
      } finally {
        setBusy(false);
      }
    },
    [refresh]
  );

  const columns: Column<QuestionRow>[] = [
    {
      key: "prompt",
      header: "Énoncé",
      render: (r) => <span data-testid="question-prompt-cell">{r.prompt}</span>,
    },
    {
      key: "kind",
      header: "Type",
      render: (r) => <span className="pill">{r.kind === "single_choice" ? "QCM" : "réponse courte"}</span>,
    },
    { key: "concept_id", header: "Concept", render: (r) => <span>{conceptName(r.concept_id)}</span> },
    { key: "points", header: "Points", align: "right", mono: true },
    {
      key: "actions",
      header: "",
      render: (r) => (
        <button
          type="button"
          className="btn ghost"
          style={{ fontSize: 12 }}
          disabled={busy}
          onClick={() => void archive(r.id)}
          data-testid="question-archive"
        >
          archiver
        </button>
      ),
    },
  ];

  return (
    <div className="col" style={{ gap: 22 }}>
      <Panel
        kicker="Banque de questions"
        title="Vos questions d'évaluation"
        aside={
          <label className="col" style={{ gap: 4 }}>
            <span className="quiet mono" style={{ fontSize: 11 }}>filtrer par concept</span>
            <select value={filterConcept} onChange={(e) => setFilterConcept(e.target.value)} data-testid="question-filter-concept">
              <option value="">— tous —</option>
              {concepts.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
        }
      >
        {questions === null ? (
          <LoadingState label="Chargement des questions…" />
        ) : loadError && questions.length === 0 ? (
          <ErrorState
            kicker="La banque de questions n'a pas répondu"
            detail="Les questions persistées n'ont pas pu être lues — rien n'est inventé pour combler le manque."
            message={loadError}
            action={
              <button type="button" className="btn" onClick={() => void refresh()}>↺ réessayer</button>
            }
          />
        ) : (
          <DataTable<QuestionRow>
            columns={columns}
            rows={(questions as QuestionRow[]) ?? []}
            rowKey={(r) => r.id}
            empty="Aucune question active — créez la première ci-dessous."
          />
        )}
      </Panel>

      <Panel kicker="Nouvelle question" title="Ajouter à la banque">
        <form onSubmit={create} className="col" style={{ gap: 12, maxWidth: 620 }} aria-label="Créer une question">
          <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
            <label className="col" style={{ gap: 4 }}>
              <span className="quiet mono" style={{ fontSize: 11 }}>type</span>
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as "single_choice" | "short_answer")}
                data-testid="question-kind"
              >
                <option value="single_choice">QCM (choix unique)</option>
                <option value="short_answer">Réponse courte</option>
              </select>
            </label>
            <label className="col" style={{ gap: 4 }}>
              <span className="quiet mono" style={{ fontSize: 11 }}>concept (optionnel)</span>
              <select value={conceptId} onChange={(e) => setConceptId(e.target.value)} data-testid="question-concept">
                <option value="">— aucun —</option>
                {concepts.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
            <label className="col" style={{ gap: 4 }}>
              <span className="quiet mono" style={{ fontSize: 11 }}>points</span>
              <input
                type="number"
                min={1}
                value={points}
                onChange={(e) => setPoints(Number(e.target.value))}
                style={{ width: 90 }}
                data-testid="question-points"
              />
            </label>
          </div>
          <label className="col" style={{ gap: 4 }}>
            <span className="quiet mono" style={{ fontSize: 11 }}>énoncé</span>
            <input
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Que garantit une transaction SQL ?"
              data-testid="question-prompt"
            />
          </label>

          {kind === "single_choice" ? (
            <div className="col" style={{ gap: 8 }}>
              <span className="quiet mono" style={{ fontSize: 11 }}>
                choix (cochez la bonne réponse)
              </span>
              {choices.map((choice, i) => (
                <div key={i} className="row" style={{ gap: 8, alignItems: "center" }}>
                  <input
                    type="radio"
                    name="correct-choice"
                    checked={correctIdx === i}
                    onChange={() => setCorrectIdx(i)}
                    aria-label={`bonne réponse : choix ${i + 1}`}
                    data-testid={`question-correct-${i}`}
                  />
                  <input
                    value={choice}
                    onChange={(e) =>
                      setChoices((cs) => cs.map((c, j) => (j === i ? e.target.value : c)))
                    }
                    placeholder={`Choix ${i + 1}`}
                    style={{ flex: 1 }}
                    data-testid={`question-choice-${i}`}
                  />
                  {choices.length > 2 ? (
                    <button
                      type="button"
                      className="btn ghost"
                      style={{ fontSize: 12 }}
                      onClick={() => {
                        setChoices((cs) => cs.filter((_, j) => j !== i));
                        setCorrectIdx((ci) => (ci === i ? 0 : ci > i ? ci - 1 : ci));
                      }}
                      aria-label={`retirer le choix ${i + 1}`}
                    >
                      retirer
                    </button>
                  ) : null}
                </div>
              ))}
              <button
                type="button"
                className="btn ghost"
                style={{ alignSelf: "flex-start", fontSize: 12 }}
                onClick={() => setChoices((cs) => [...cs, ""])}
                data-testid="question-add-choice"
              >
                + ajouter un choix
              </button>
            </div>
          ) : (
            <label className="col" style={{ gap: 4 }}>
              <span className="quiet mono" style={{ fontSize: 11 }}>réponse attendue</span>
              <input
                value={expected}
                onChange={(e) => setExpected(e.target.value)}
                placeholder="atomicité, cohérence, isolation, durabilité"
                data-testid="question-expected"
              />
            </label>
          )}

          {error ? (
            <p className="mono" style={{ color: "var(--alarm)", fontSize: 12 }}>{error}</p>
          ) : null}
          <div>
            <button type="submit" className="btn primary" disabled={busy} data-testid="question-create">
              {busy ? "…" : "Créer la question"}
            </button>
          </div>
        </form>
      </Panel>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Volet 2 — devoirs (création par cohorte)
// ---------------------------------------------------------------------------

function AssignmentsPane({
  cohortId,
  cohortName,
  domainId,
  concepts,
  conceptName,
}: {
  cohortId: string;
  cohortName: string;
  domainId: string;
  concepts: Concept[];
  conceptName: (id?: string) => string;
}) {
  const [assignments, setAssignments] = useState<Assignment[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", dueDate: "", dueTime: "23:59", conceptId: "" });

  const refresh = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch(`/api/trainer/assignments?cohortId=${encodeURIComponent(cohortId)}`);
      if (!res.ok) throw new Error(await readError(res));
      setAssignments(((await res.json()) as Assignment[]) ?? []);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "chargement impossible");
      setAssignments([]);
    }
  }, [cohortId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      if (!form.title.trim()) {
        setError("le titre est requis");
        return;
      }
      setBusy(true);
      try {
        const res = await fetch("/api/trainer/assignments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cohortId,
            title: form.title,
            description: form.description,
            due_at: form.dueDate
              ? new Date(`${form.dueDate}T${form.dueTime || "23:59"}:00`).toISOString()
              : undefined,
            // Lier un concept relie la note au moteur adaptatif (domain requis).
            concept_id: form.conceptId || "",
            domain_id: form.conceptId ? domainId : "",
          }),
        });
        if (!res.ok) throw new Error(await readError(res));
        setForm((f) => ({ ...f, title: "", description: "", dueDate: "", conceptId: "" }));
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "création impossible");
      } finally {
        setBusy(false);
      }
    },
    [cohortId, domainId, form, refresh]
  );

  const columns: Column<AssignmentRow>[] = [
    { key: "title", header: "Devoir", render: (r) => <span data-testid="assignment-title-cell">{r.title}</span> },
    { key: "due_at", header: "Échéance", mono: true, render: (r) => <span>{r.due_at ? fmtDate(r.due_at) : "sans échéance"}</span> },
    {
      key: "concept_id",
      header: "Concept lié",
      render: (r) =>
        r.concept_id ? (
          <span className="pill on">{conceptName(r.concept_id)}</span>
        ) : (
          <span className="quiet">—</span>
        ),
    },
    { key: "created_at", header: "Créé le", mono: true, render: (r) => <span>{fmtDate(r.created_at)}</span> },
  ];

  const active = (assignments ?? []).filter((a) => !a.archived_at);

  return (
    <div className="col" style={{ gap: 22 }}>
      <Panel kicker="Devoirs" title={`Devoirs du groupe ${cohortName}`}>
        {assignments === null ? (
          <LoadingState label="Chargement des devoirs…" />
        ) : loadError && assignments.length === 0 ? (
          <ErrorState
            kicker="La liste des devoirs n'a pas répondu"
            detail="Les devoirs persistés n'ont pas pu être lus — rien n'est inventé pour combler le manque."
            message={loadError}
            action={
              <button type="button" className="btn" onClick={() => void refresh()}>↺ réessayer</button>
            }
          />
        ) : (
          <DataTable<AssignmentRow>
            columns={columns}
            rows={(active as AssignmentRow[]) ?? []}
            rowKey={(r) => r.id}
            empty="Aucun devoir pour ce groupe — créez le premier ci-dessous."
          />
        )}
      </Panel>

      <Panel kicker="Nouveau devoir" title="Créer un devoir">
        <form onSubmit={create} className="col" style={{ gap: 12, maxWidth: 620 }} aria-label="Créer un devoir">
          <label className="col" style={{ gap: 4 }}>
            <span className="quiet mono" style={{ fontSize: 11 }}>titre</span>
            <input
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="Implémenter une transaction avec rollback"
              data-testid="assignment-title"
            />
          </label>
          <label className="col" style={{ gap: 4 }}>
            <span className="quiet mono" style={{ fontSize: 11 }}>consignes (optionnel)</span>
            <textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              rows={3}
              data-testid="assignment-desc"
            />
          </label>
          <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
            <label className="col" style={{ gap: 4 }}>
              <span className="quiet mono" style={{ fontSize: 11 }}>échéance (optionnel)</span>
              <input
                type="date"
                value={form.dueDate}
                onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))}
                data-testid="assignment-due"
              />
            </label>
            <label className="col" style={{ gap: 4 }}>
              <span className="quiet mono" style={{ fontSize: 11 }}>heure limite</span>
              <input
                type="time"
                value={form.dueTime}
                onChange={(e) => setForm((f) => ({ ...f, dueTime: e.target.value }))}
              />
            </label>
            <label className="col" style={{ gap: 4 }}>
              <span className="quiet mono" style={{ fontSize: 11 }}>concept lié (optionnel — alimente le moteur)</span>
              <select
                value={form.conceptId}
                onChange={(e) => setForm((f) => ({ ...f, conceptId: e.target.value }))}
                data-testid="assignment-concept"
              >
                <option value="">— aucun —</option>
                {concepts.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
          </div>
          {error ? (
            <p className="mono" style={{ color: "var(--alarm)", fontSize: 12 }}>{error}</p>
          ) : null}
          <div>
            <button type="submit" className="btn primary" disabled={busy || !cohortId} data-testid="assignment-create">
              {busy ? "…" : "Créer le devoir"}
            </button>
          </div>
        </form>
      </Panel>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Volet 3 — file de correction (soumissions non notées d'abord)
// ---------------------------------------------------------------------------

function GradingQueue({
  cohortId,
  learnerName,
  conceptName,
}: {
  cohortId: string;
  learnerName: (id: string) => string;
  conceptName: (id?: string) => string;
}) {
  const [assignments, setAssignments] = useState<Assignment[] | null>(null);
  const [assignmentId, setAssignmentId] = useState("");
  const [submissions, setSubmissions] = useState<AssignmentSubmission[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Per-submission grading inputs (note sur 100 + feedback).
  const [drafts, setDrafts] = useState<Record<string, { note: string; feedback: string }>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/trainer/assignments?cohortId=${encodeURIComponent(cohortId)}`);
        if (!res.ok) throw new Error(await readError(res));
        const list = (((await res.json()) as Assignment[]) ?? []).filter((a) => !a.archived_at);
        if (cancelled) return;
        setAssignments(list);
        setAssignmentId((cur) => cur || list[0]?.id || "");
      } catch (e) {
        if (!cancelled) {
          setAssignments([]);
          setLoadError(e instanceof Error ? e.message : "chargement impossible");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cohortId]);

  const refreshSubmissions = useCallback(async () => {
    if (!assignmentId) {
      setSubmissions([]);
      return;
    }
    setLoadError(null);
    try {
      const res = await fetch(`/api/trainer/assignments/${encodeURIComponent(assignmentId)}/submissions`);
      if (!res.ok) throw new Error(await readError(res));
      setSubmissions(((await res.json()) as AssignmentSubmission[]) ?? []);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "chargement impossible");
      setSubmissions([]);
    }
  }, [assignmentId]);

  useEffect(() => {
    setSubmissions(null);
    void refreshSubmissions();
  }, [refreshSubmissions]);

  const grade = useCallback(
    async (submissionId: string) => {
      const draft = drafts[submissionId] ?? { note: "", feedback: "" };
      const note = Number(draft.note);
      setError(null);
      if (!Number.isFinite(note) || note < 0 || note > 100) {
        setError("la note doit être comprise entre 0 et 100");
        return;
      }
      setBusy(true);
      try {
        const res = await fetch(`/api/trainer/submissions/${encodeURIComponent(submissionId)}/grade`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // Note sur 100 dans l'UI ; le backend attend un score 0..1.
          body: JSON.stringify({ score: note / 100, feedback: draft.feedback }),
        });
        if (!res.ok) throw new Error(await readError(res));
        await refreshSubmissions();
      } catch (err) {
        setError(err instanceof Error ? err.message : "correction impossible");
      } finally {
        setBusy(false);
      }
    },
    [drafts, refreshSubmissions]
  );

  const selected = useMemo(
    () => (assignments ?? []).find((a) => a.id === assignmentId),
    [assignments, assignmentId]
  );

  // Les copies sans note d'abord (la file de travail), puis les notées.
  const queue = useMemo(() => {
    const subs = submissions ?? [];
    const ungraded = subs.filter((s) => s.score === null || s.score === undefined);
    const graded = subs.filter((s) => !(s.score === null || s.score === undefined));
    return [...ungraded, ...graded];
  }, [submissions]);

  return (
    <Panel
      kicker="File de correction"
      title="Corriger les rendus"
      aside={
        <label className="col" style={{ gap: 4 }}>
          <span className="quiet mono" style={{ fontSize: 11 }}>devoir</span>
          <select value={assignmentId} onChange={(e) => setAssignmentId(e.target.value)} data-testid="grading-assignment">
            {(assignments ?? []).map((a) => (
              <option key={a.id} value={a.id}>{a.title}</option>
            ))}
          </select>
        </label>
      }
    >
      {selected?.concept_id ? (
        <p className="quiet mono" style={{ fontSize: 11, marginBottom: 12 }}>
          devoir lié au concept « {conceptName(selected.concept_id)} » — la note alimentera le moteur
          adaptatif comme évidence corrigée.
        </p>
      ) : null}
      {assignments !== null && assignments.length === 0 ? (
        <p className="quiet" style={{ fontSize: 14 }}>
          Aucun devoir — créez-en un dans le volet « Devoirs » pour ouvrir une file de correction.
        </p>
      ) : submissions === null ? (
        <LoadingState label="Chargement des rendus…" />
      ) : loadError && queue.length === 0 ? (
        <ErrorState
          kicker="Les rendus n'ont pas répondu"
          detail="Les soumissions persistées n'ont pas pu être lues — rien n'est inventé pour combler le manque."
          message={loadError}
          action={
            <button type="button" className="btn" onClick={() => void refreshSubmissions()}>↺ réessayer</button>
          }
        />
      ) : queue.length === 0 ? (
        <p className="quiet" style={{ fontSize: 14 }}>Aucun rendu pour ce devoir pour l&apos;instant.</p>
      ) : (
        <div className="col" style={{ gap: 14 }}>
          {error ? (
            <p className="mono" style={{ color: "var(--alarm)", fontSize: 12 }}>{error}</p>
          ) : null}
          {queue.map((s) => {
            const graded = !(s.score === null || s.score === undefined);
            const draft = drafts[s.id] ?? { note: "", feedback: "" };
            return (
              <section
                key={s.id}
                className="panel col"
                style={{ gap: 10 }}
                data-testid="submission-row"
                data-learner={s.learner_id}
              >
                <div className="spread" style={{ flexWrap: "wrap", gap: 10, alignItems: "baseline" }}>
                  <div className="row" style={{ gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                    <strong>{learnerName(s.learner_id)}</strong>
                    <span className="mono quiet" style={{ fontSize: 11 }}>
                      rendu le {fmtDate(s.submitted_at)}
                    </span>
                  </div>
                  {graded ? (
                    <span className="pill on" data-testid="submission-score">
                      {Math.round((s.score as number) * 100)}/100
                    </span>
                  ) : (
                    <span className="pill">à corriger</span>
                  )}
                </div>
                <p
                  className="mono"
                  style={{
                    fontSize: 12.5,
                    whiteSpace: "pre-wrap",
                    background: "var(--paper)",
                    border: "1px solid var(--line)",
                    borderRadius: 8,
                    padding: "10px 12px",
                    margin: 0,
                  }}
                >
                  {s.content}
                </p>
                {graded ? (
                  s.feedback ? (
                    <p className="soft" style={{ fontSize: 13, margin: 0 }}>
                      <span className="kicker" style={{ marginRight: 8 }}>feedback</span>
                      {s.feedback}
                    </p>
                  ) : null
                ) : (
                  <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
                    <label className="col" style={{ gap: 4 }}>
                      <span className="quiet mono" style={{ fontSize: 11 }}>note /100</span>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={draft.note}
                        onChange={(e) =>
                          setDrafts((d) => ({ ...d, [s.id]: { ...draft, note: e.target.value } }))
                        }
                        style={{ width: 90 }}
                        data-testid="grade-score"
                      />
                    </label>
                    <label className="col" style={{ gap: 4, flex: 1, minWidth: 220 }}>
                      <span className="quiet mono" style={{ fontSize: 11 }}>feedback (optionnel)</span>
                      <input
                        value={draft.feedback}
                        onChange={(e) =>
                          setDrafts((d) => ({ ...d, [s.id]: { ...draft, feedback: e.target.value } }))
                        }
                        data-testid="grade-feedback"
                      />
                    </label>
                    <button
                      type="button"
                      className="btn primary"
                      disabled={busy}
                      onClick={() => void grade(s.id)}
                      data-testid="grade-submit"
                    >
                      {busy ? "…" : "Noter"}
                    </button>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </Panel>
  );
}
