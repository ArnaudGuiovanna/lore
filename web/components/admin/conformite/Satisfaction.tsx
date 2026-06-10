"use client";

// B-11 — enquêtes de satisfaction : création à chaud (HOT) / à froid (COLD)
// avec questions dynamiques (échelle 1..5 ou texte libre), liste, et résultats
// (moyenne par question scale + verbatims des questions text).
import { useCallback, useEffect, useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Drawer } from "@/components/ui/Drawer";
import { ErrorState, LoadingState } from "@/components/ui/States";
import type { SatisfactionSurvey, SurveyQuestion, SurveyResponse } from "@/lib/types";
import type { NamedRef } from "./Conformite";

type Row = SatisfactionSurvey & Record<string, unknown>;

interface DraftQuestion {
  prompt: string;
  kind: "scale" | "text";
}

function fmtDate(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("fr-FR", { dateStyle: "medium" });
}

export function Satisfaction({ cohorts, learners }: { cohorts: NamedRef[]; learners: NamedRef[] }) {
  const [surveys, setSurveys] = useState<SatisfactionSurvey[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [form, setForm] = useState({
    cohortId: cohorts[0]?.id ?? "",
    kind: "HOT" as "HOT" | "COLD",
    title: "",
  });
  const [questions, setQuestions] = useState<DraftQuestion[]>([
    { prompt: "Recommanderiez-vous cette formation ?", kind: "scale" },
  ]);

  // Résultats d'une enquête (drawer).
  const [results, setResults] = useState<{
    survey: SatisfactionSurvey;
    responses: SurveyResponse[];
  } | null>(null);
  const [resultsError, setResultsError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch("/api/admin/conformite/surveys");
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setSurveys(((await res.json()) as SatisfactionSurvey[]) ?? []);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "chargement impossible");
      setSurveys([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const valid = questions.filter((q) => q.prompt.trim() !== "");
      if (!form.cohortId || !form.title.trim() || valid.length === 0) {
        setError("cohorte, titre et au moins une question sont requis");
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const payload: SurveyQuestion[] = valid.map((q, i) => ({
          id: `q${i + 1}`,
          prompt: q.prompt.trim(),
          kind: q.kind,
        }));
        const res = await fetch("/api/admin/conformite/surveys", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cohort_id: form.cohortId,
            kind: form.kind,
            title: form.title.trim(),
            questions: payload,
          }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        setForm((f) => ({ ...f, title: "" }));
        setQuestions([{ prompt: "Recommanderiez-vous cette formation ?", kind: "scale" }]);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "création impossible");
      } finally {
        setBusy(false);
      }
    },
    [form, questions, refresh]
  );

  const openResults = useCallback(async (survey: SatisfactionSurvey) => {
    setResultsError(null);
    setResults({ survey, responses: [] });
    try {
      const res = await fetch(
        `/api/admin/conformite/surveys/${encodeURIComponent(survey.id)}/responses`
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setResults({ survey, responses: ((await res.json()) as SurveyResponse[]) ?? [] });
    } catch (e) {
      setResultsError(e instanceof Error ? e.message : "lecture impossible");
    }
  }, []);

  const cohortName = (id: string) => cohorts.find((c) => c.id === id)?.name ?? id.slice(0, 8);
  const learnerName = (id: string) => learners.find((l) => l.id === id)?.name ?? id.slice(0, 8);

  const columns: Column<Row>[] = [
    { key: "title", header: "Enquête" },
    {
      key: "kind",
      header: "Type",
      render: (r) => <span className="pill">{r.kind === "HOT" ? "à chaud" : "à froid"}</span>,
    },
    { key: "cohort_id", header: "Cohorte", render: (r) => <span>{cohortName(r.cohort_id)}</span> },
    {
      key: "questions",
      header: "Questions",
      align: "right",
      mono: true,
      render: (r) => <span>{r.questions.length}</span>,
    },
    { key: "created_at", header: "Créée le", mono: true, render: (r) => <span>{fmtDate(r.created_at)}</span> },
    {
      key: "actions",
      header: "",
      render: (r) => (
        <button
          type="button"
          className="btn ghost"
          style={{ fontSize: 12 }}
          onClick={() => void openResults(r)}
          data-testid="survey-results"
        >
          résultats
        </button>
      ),
    },
  ];

  // Agrégats des résultats : moyenne par question scale + verbatims text.
  const aggregates = (() => {
    if (!results) return [];
    return results.survey.questions.map((q) => {
      if (q.kind === "scale") {
        const values = results.responses
          .map((r) => r.answers[q.id])
          .filter((v): v is number => typeof v === "number");
        const avg = values.length
          ? values.reduce((sum, v) => sum + v, 0) / values.length
          : null;
        return { question: q, avg, count: values.length, verbatims: [] as string[] };
      }
      const verbatims = results.responses
        .map((r) => r.answers[q.id])
        .filter((v): v is string => typeof v === "string" && v.trim() !== "");
      return { question: q, avg: null, count: verbatims.length, verbatims };
    });
  })();

  return (
    <div className="col" style={{ gap: 22 }}>
      <Panel
        kicker="Satisfaction"
        title="Enquêtes à chaud et à froid"
        aside={<span className="mono quiet" style={{ fontSize: 11 }}>indicateur RNQ 30</span>}
      >
        {surveys === null ? (
          <LoadingState label="Chargement des enquêtes…" />
        ) : loadError && surveys.length === 0 ? (
          <ErrorState
            kicker="Les enquêtes n'ont pas répondu"
            detail="La liste des enquêtes n'a pas pu être lue — rien n'est inventé pour combler le manque."
            message={loadError}
            action={
              <button type="button" className="btn" onClick={() => void refresh()}>
                ↺ réessayer
              </button>
            }
          />
        ) : (
          <DataTable<Row>
            columns={columns}
            rows={(surveys as Row[]) ?? []}
            rowKey={(r) => r.id}
            empty="Aucune enquête — créez la première ci-dessous."
          />
        )}
      </Panel>

      <Panel kicker="Nouvelle enquête" title="Créer une enquête de satisfaction">
        <form onSubmit={create} className="col" style={{ gap: 12, maxWidth: 680 }} data-testid="survey-create-form">
          <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
            <label className="col" style={{ gap: 4 }}>
              <span className="quiet mono" style={{ fontSize: 11 }}>cohorte</span>
              <select
                value={form.cohortId}
                onChange={(e) => setForm((f) => ({ ...f, cohortId: e.target.value }))}
                data-testid="survey-cohort"
              >
                {cohorts.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
            <label className="col" style={{ gap: 4 }}>
              <span className="quiet mono" style={{ fontSize: 11 }}>moment</span>
              <select
                value={form.kind}
                onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as "HOT" | "COLD" }))}
                data-testid="survey-kind"
              >
                <option value="HOT">à chaud (fin de formation)</option>
                <option value="COLD">à froid (quelques semaines après)</option>
              </select>
            </label>
            <label className="col" style={{ gap: 4, flex: 1, minWidth: 220 }}>
              <span className="quiet mono" style={{ fontSize: 11 }}>titre</span>
              <input
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="Votre avis sur la session"
                data-testid="survey-title"
              />
            </label>
          </div>

          <div className="col" style={{ gap: 8 }}>
            <span className="quiet mono" style={{ fontSize: 11 }}>questions</span>
            {questions.map((q, i) => (
              <div key={i} className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <input
                  style={{ flex: 1, minWidth: 260 }}
                  value={q.prompt}
                  onChange={(e) =>
                    setQuestions((qs) => qs.map((x, j) => (j === i ? { ...x, prompt: e.target.value } : x)))
                  }
                  placeholder={`Question ${i + 1}`}
                  data-testid={`survey-q-${i}`}
                />
                <select
                  value={q.kind}
                  onChange={(e) =>
                    setQuestions((qs) =>
                      qs.map((x, j) => (j === i ? { ...x, kind: e.target.value as "scale" | "text" } : x))
                    )
                  }
                  data-testid={`survey-q-kind-${i}`}
                >
                  <option value="scale">échelle 1..5</option>
                  <option value="text">texte libre</option>
                </select>
                {questions.length > 1 ? (
                  <button
                    type="button"
                    className="btn ghost"
                    style={{ fontSize: 12 }}
                    onClick={() => setQuestions((qs) => qs.filter((_, j) => j !== i))}
                    aria-label={`Supprimer la question ${i + 1}`}
                  >
                    ✕
                  </button>
                ) : null}
              </div>
            ))}
            <div>
              <button
                type="button"
                className="btn ghost"
                style={{ fontSize: 12 }}
                onClick={() => setQuestions((qs) => [...qs, { prompt: "", kind: "scale" }])}
              >
                + ajouter une question
              </button>
            </div>
          </div>

          {error ? (
            <p className="mono" style={{ color: "var(--alarm)", fontSize: 12, margin: 0 }}>{error}</p>
          ) : null}
          <div>
            <button
              type="submit"
              className="btn primary"
              disabled={busy || cohorts.length === 0}
              data-testid="survey-create-submit"
            >
              {busy ? "…" : "Publier l'enquête"}
            </button>
          </div>
        </form>
      </Panel>

      <Drawer
        open={!!results}
        onClose={() => setResults(null)}
        kicker={results ? `${results.responses.length} réponse(s)` : ""}
        title={results ? `Résultats · ${results.survey.title}` : ""}
        width={560}
      >
        {resultsError ? (
          <p className="mono" style={{ color: "var(--alarm)", fontSize: 12 }}>{resultsError}</p>
        ) : results ? (
          <div className="col" style={{ gap: 18 }}>
            {aggregates.map(({ question, avg, count, verbatims }) => (
              <div key={question.id} className="col" style={{ gap: 6 }}>
                <p style={{ fontFamily: "var(--serif)", fontSize: 15, margin: 0 }}>{question.prompt}</p>
                {question.kind === "scale" ? (
                  <p className="mono" style={{ fontSize: 13, margin: 0 }} data-testid={`survey-avg-${question.id}`}>
                    moyenne ·{" "}
                    <strong>{avg === null ? "—" : avg.toLocaleString("fr-FR", { maximumFractionDigits: 2 })}</strong>{" "}
                    / 5 <span className="quiet">({count} réponse{count > 1 ? "s" : ""})</span>
                  </p>
                ) : verbatims.length === 0 ? (
                  <p className="quiet mono" style={{ fontSize: 12, margin: 0 }}>aucun verbatim</p>
                ) : (
                  <ul className="col" style={{ gap: 6, margin: 0, paddingLeft: 18 }}>
                    {verbatims.map((v, i) => (
                      <li key={i} className="soft" style={{ fontSize: 13.5 }}>
                        « {v} »
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
            {results.responses.length > 0 ? (
              <p className="quiet mono" style={{ fontSize: 11, margin: 0 }}>
                répondants · {results.responses.map((r) => learnerName(r.learner_id)).join(", ")}
              </p>
            ) : (
              <p className="quiet mono" style={{ fontSize: 12, margin: 0 }}>
                Aucune réponse pour l&apos;instant.
              </p>
            )}
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}
