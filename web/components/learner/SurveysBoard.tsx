"use client";

// B-11 — « Mon avis » : les enquêtes ouvertes des cohortes de l'apprenant
// (étoiles 1..5 pour les questions scale, texte libre sinon) + le dépôt d'une
// réclamation. Une enquête déjà répondue affiche une confirmation, pas un
// second formulaire.
import { useCallback, useEffect, useState } from "react";
import { ErrorState, LoadingState } from "@/components/ui/States";
import type { SatisfactionSurvey, SurveyResponse } from "@/lib/types";

interface RowData {
  survey: SatisfactionSurvey;
  open: boolean;
  my_response: SurveyResponse | null;
}

function StarScale({
  value,
  onChange,
  questionId,
}: {
  value: number | null;
  onChange: (v: number) => void;
  questionId: string;
}) {
  return (
    <div className="row" role="radiogroup" aria-label="note de 1 à 5" style={{ gap: 6 }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} sur 5`}
          onClick={() => onChange(n)}
          data-testid={`survey-star-${questionId}-${n}`}
          className="btn ghost"
          style={{
            fontSize: 18,
            lineHeight: 1,
            padding: "6px 8px",
            color: value !== null && n <= value ? "var(--amber)" : "var(--line-2)",
          }}
        >
          ★
        </button>
      ))}
      <span className="mono quiet" style={{ fontSize: 12, alignSelf: "center" }}>
        {value === null ? "—" : `${value}/5`}
      </span>
    </div>
  );
}

export function SurveysBoard() {
  const [rows, setRows] = useState<RowData[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // drafts[surveyId][questionId] = number | string
  const [drafts, setDrafts] = useState<Record<string, Record<string, number | string>>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [justSent, setJustSent] = useState<Record<string, boolean>>({});

  // Réclamation.
  const [complaint, setComplaint] = useState({ subject: "", description: "" });
  const [complaintBusy, setComplaintBusy] = useState(false);
  const [complaintError, setComplaintError] = useState<string | null>(null);
  const [complaintSent, setComplaintSent] = useState(false);

  const refresh = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch("/api/learner/surveys");
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setRows(((await res.json()) as RowData[]) ?? []);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "chargement impossible");
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const submit = useCallback(
    async (survey: SatisfactionSurvey) => {
      const draft = drafts[survey.id] ?? {};
      const answers: Record<string, number | string> = {};
      for (const q of survey.questions) {
        const v = draft[q.id];
        if (q.kind === "scale" && typeof v === "number") answers[q.id] = v;
        if (q.kind === "text" && typeof v === "string" && v.trim() !== "") answers[q.id] = v.trim();
      }
      if (Object.keys(answers).length === 0) {
        setErrors((e) => ({ ...e, [survey.id]: "répondez à au moins une question" }));
        return;
      }
      setBusyId(survey.id);
      setErrors((e) => ({ ...e, [survey.id]: "" }));
      try {
        const res = await fetch(`/api/learner/surveys/${encodeURIComponent(survey.id)}/responses`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ answers }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        setJustSent((s) => ({ ...s, [survey.id]: true }));
        await refresh();
      } catch (err) {
        setErrors((e) => ({
          ...e,
          [survey.id]: err instanceof Error ? err.message : "envoi impossible",
        }));
      } finally {
        setBusyId(null);
      }
    },
    [drafts, refresh]
  );

  const sendComplaint = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!complaint.subject.trim()) {
        setComplaintError("l'objet est requis");
        return;
      }
      setComplaintBusy(true);
      setComplaintError(null);
      try {
        const res = await fetch("/api/learner/complaints", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subject: complaint.subject.trim(),
            description: complaint.description.trim() || undefined,
          }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        setComplaint({ subject: "", description: "" });
        setComplaintSent(true);
      } catch (err) {
        setComplaintError(err instanceof Error ? err.message : "dépôt impossible");
      } finally {
        setComplaintBusy(false);
      }
    },
    [complaint]
  );

  return (
    <div className="col" style={{ gap: 22 }}>
      {rows === null ? (
        <LoadingState label="Chargement des enquêtes…" />
      ) : loadError && rows.length === 0 ? (
        <ErrorState
          kicker="Les enquêtes n'ont pas répondu"
          detail="Nous n'avons pas pu lire vos enquêtes — rien n'est inventé pour combler le manque."
          message={loadError}
          action={
            <button type="button" className="btn" onClick={() => void refresh()}>
              ↺ réessayer
            </button>
          }
        />
      ) : rows.length === 0 ? (
        <section className="panel col" style={{ gap: 10 }} data-testid="learner-surveys-empty">
          <span className="kicker">Aucune enquête pour l&apos;instant</span>
          <p className="soft" style={{ maxWidth: "58ch", fontSize: 15, lineHeight: 1.6 }}>
            Quand votre organisme ouvrira une enquête de satisfaction (à chaud en fin de
            formation, à froid quelques semaines après), elle apparaîtra ici.
          </p>
        </section>
      ) : (
        rows.map(({ survey, open, my_response }) => {
          const answered = !!my_response;
          const draft = drafts[survey.id] ?? {};
          return (
            <section
              key={survey.id}
              className="panel col"
              style={{ gap: 12 }}
              data-testid="learner-survey-card"
              data-title={survey.title}
            >
              <div className="spread" style={{ flexWrap: "wrap", gap: 10, alignItems: "baseline" }}>
                <h2 style={{ fontSize: 19 }}>{survey.title}</h2>
                <span className="row" style={{ gap: 8 }}>
                  <span className="pill">{survey.kind === "HOT" ? "à chaud" : "à froid"}</span>
                  {answered ? (
                    <span className="pill on" data-testid="survey-answered">répondu ✓</span>
                  ) : !open ? (
                    <span className="pill">fermée</span>
                  ) : null}
                </span>
              </div>

              {answered ? (
                <div className="col" style={{ gap: 6 }} data-testid="survey-confirmation">
                  <p className="soft" style={{ margin: 0, fontSize: 14 }}>
                    Merci, votre avis a bien été enregistré
                    {justSent[survey.id] ? " à l'instant" : ""}. Vos réponses :
                  </p>
                  <ul className="col" style={{ gap: 4, margin: 0, paddingLeft: 18 }}>
                    {survey.questions.map((q) => {
                      const v = my_response?.answers?.[q.id];
                      if (v === undefined || v === null || v === "") return null;
                      return (
                        <li key={q.id} className="quiet" style={{ fontSize: 13 }}>
                          {q.prompt} — <strong>{q.kind === "scale" ? `${v}/5` : `« ${v} »`}</strong>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : !open ? (
                <p className="quiet mono" style={{ fontSize: 12, margin: 0 }}>
                  Cette enquête n&apos;est pas (ou plus) ouverte aux réponses.
                </p>
              ) : (
                <div className="col" style={{ gap: 14 }}>
                  {survey.questions.map((q) => (
                    <div key={q.id} className="col" style={{ gap: 6 }}>
                      <p style={{ fontFamily: "var(--serif)", fontSize: 15, margin: 0 }}>{q.prompt}</p>
                      {q.kind === "scale" ? (
                        <StarScale
                          questionId={q.id}
                          value={typeof draft[q.id] === "number" ? (draft[q.id] as number) : null}
                          onChange={(v) =>
                            setDrafts((d) => ({ ...d, [survey.id]: { ...(d[survey.id] ?? {}), [q.id]: v } }))
                          }
                        />
                      ) : (
                        <textarea
                          rows={3}
                          value={typeof draft[q.id] === "string" ? (draft[q.id] as string) : ""}
                          onChange={(e) =>
                            setDrafts((d) => ({
                              ...d,
                              [survey.id]: { ...(d[survey.id] ?? {}), [q.id]: e.target.value },
                            }))
                          }
                          placeholder="Votre réponse…"
                          data-testid={`survey-text-${q.id}`}
                        />
                      )}
                    </div>
                  ))}
                  {errors[survey.id] ? (
                    <p className="mono" style={{ color: "var(--alarm)", fontSize: 12, margin: 0 }}>
                      {errors[survey.id]}
                    </p>
                  ) : null}
                  <div>
                    <button
                      type="button"
                      className="btn primary"
                      disabled={busyId === survey.id}
                      onClick={() => void submit(survey)}
                      data-testid="survey-submit"
                    >
                      {busyId === survey.id ? "Envoi…" : "Envoyer mon avis"}
                    </button>
                  </div>
                </div>
              )}
            </section>
          );
        })
      )}

      <section className="panel col" style={{ gap: 12 }}>
        <span className="kicker">Réclamation</span>
        <h2 style={{ fontSize: 19 }}>Déposer une réclamation</h2>
        <p className="soft" style={{ maxWidth: "58ch", fontSize: 14, lineHeight: 1.6, margin: 0 }}>
          Un problème avec votre formation ? Votre réclamation entre au registre de
          l&apos;organisme et suit un traitement tracé (ouverture → traitement → résolution).
        </p>
        {complaintSent ? (
          <div className="col" style={{ gap: 8 }} data-testid="complaint-confirmation">
            <span className="pill on">réclamation déposée ✓</span>
            <p className="quiet" style={{ fontSize: 13, margin: 0 }}>
              Elle a été enregistrée au registre. Vous pouvez en déposer une autre si besoin.
            </p>
            <div>
              <button type="button" className="btn ghost" style={{ fontSize: 12 }} onClick={() => setComplaintSent(false)}>
                déposer une autre réclamation
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={sendComplaint} className="col" style={{ gap: 10, maxWidth: 560 }} data-testid="complaint-form">
            <label className="col" style={{ gap: 4 }}>
              <span className="quiet mono" style={{ fontSize: 11 }}>objet</span>
              <input
                value={complaint.subject}
                onChange={(e) => setComplaint((c) => ({ ...c, subject: e.target.value }))}
                placeholder="Objet de la réclamation"
                data-testid="complaint-subject"
              />
            </label>
            <label className="col" style={{ gap: 4 }}>
              <span className="quiet mono" style={{ fontSize: 11 }}>description</span>
              <textarea
                rows={4}
                value={complaint.description}
                onChange={(e) => setComplaint((c) => ({ ...c, description: e.target.value }))}
                placeholder="Décrivez ce qui s'est passé…"
                data-testid="complaint-description"
              />
            </label>
            {complaintError ? (
              <p className="mono" style={{ color: "var(--alarm)", fontSize: 12, margin: 0 }}>{complaintError}</p>
            ) : null}
            <div>
              <button type="submit" className="btn" disabled={complaintBusy} data-testid="complaint-submit">
                {complaintBusy ? "Dépôt…" : "Déposer la réclamation"}
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
