"use client";

// B-26 — learner assignments board: list with status (à rendre / rendu / noté),
// a text area to hand in (or replace, while ungraded), and the grade + feedback
// once corrected. Data comes from /api/learner/assignments (session-scoped).
import { useCallback, useEffect, useState } from "react";
import { ErrorState, LoadingState } from "@/components/ui/States";
import type { Assignment, AssignmentSubmission } from "@/lib/types";

interface Row {
  assignment: Assignment;
  submission: AssignmentSubmission | null;
}

function fmtDate(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" });
}

function statusOf(row: Row): { label: string; on: boolean } {
  if (row.submission && row.submission.score !== null && row.submission.score !== undefined) {
    return { label: "noté", on: true };
  }
  if (row.submission) return { label: "rendu", on: true };
  return { label: "à rendre", on: false };
}

export function AssignmentsBoard() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch("/api/learner/assignments");
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setRows(((await res.json()) as Row[]) ?? []);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "chargement impossible");
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const submit = useCallback(
    async (assignmentId: string) => {
      const content = (drafts[assignmentId] ?? "").trim();
      setErrors((e) => ({ ...e, [assignmentId]: "" }));
      if (!content) {
        setErrors((e) => ({ ...e, [assignmentId]: "écrivez votre rendu avant d'envoyer" }));
        return;
      }
      setBusyId(assignmentId);
      try {
        const res = await fetch(`/api/learner/assignments/${encodeURIComponent(assignmentId)}/submit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        setDrafts((d) => ({ ...d, [assignmentId]: "" }));
        await refresh();
      } catch (err) {
        setErrors((e) => ({
          ...e,
          [assignmentId]: err instanceof Error ? err.message : "envoi impossible",
        }));
      } finally {
        setBusyId(null);
      }
    },
    [drafts, refresh]
  );

  if (rows === null) return <LoadingState label="Chargement des devoirs…" />;

  if (loadError && rows.length === 0) {
    return (
      <ErrorState
        kicker="Les devoirs n'ont pas répondu"
        detail="Nous n'avons pas pu lire vos devoirs ; rien n'est inventé pour combler le manque. Vos rendus existants sont en sécurité sur le backend — ceci n'est qu'une lecture."
        message={loadError}
        action={
          <button type="button" className="btn" onClick={() => void refresh()}>
            ↺ réessayer
          </button>
        }
      />
    );
  }

  if (rows.length === 0) {
    return (
      <section className="panel col" style={{ gap: 10 }} data-testid="assignments-empty">
        <span className="kicker">Aucun devoir pour l&apos;instant</span>
        <p className="soft" style={{ maxWidth: "58ch", fontSize: 15, lineHeight: 1.6 }}>
          Votre formateur n&apos;a pas encore créé de devoir pour votre groupe. Quand un devoir
          sera publié, il apparaîtra ici avec son échéance.
        </p>
      </section>
    );
  }

  const sorted = [...rows].sort((a, b) => {
    const da = a.assignment.due_at ? Date.parse(a.assignment.due_at) : Number.POSITIVE_INFINITY;
    const db = b.assignment.due_at ? Date.parse(b.assignment.due_at) : Number.POSITIVE_INFINITY;
    return da - db;
  });

  return (
    <div className="col" style={{ gap: 14 }}>
      {sorted.map((row) => {
        const a = row.assignment;
        const sub = row.submission;
        const st = statusOf(row);
        const graded = sub !== null && sub.score !== null && sub.score !== undefined;
        const overdue = !!a.due_at && Date.now() > Date.parse(a.due_at) && !sub;
        return (
          <section key={a.id} className="panel col" style={{ gap: 12 }} data-testid="assignment-card" data-title={a.title}>
            <div className="spread" style={{ flexWrap: "wrap", gap: 10, alignItems: "baseline" }}>
              <h2 style={{ fontSize: 19 }}>{a.title}</h2>
              <span className={`pill ${st.on ? "on" : ""}`} data-testid="assignment-status">
                {st.label}
              </span>
            </div>
            <p className="mono quiet" style={{ fontSize: 11, margin: 0 }}>
              échéance · {a.due_at ? fmtDate(a.due_at) : "sans échéance"}
              {overdue ? <span style={{ color: "var(--alarm)" }}> · dépassée</span> : null}
            </p>
            {a.description ? (
              <p className="soft" style={{ fontSize: 14, lineHeight: 1.6, margin: 0, maxWidth: "62ch" }}>
                {a.description}
              </p>
            ) : null}

            {sub ? (
              <div className="col" style={{ gap: 6 }}>
                <span className="quiet mono" style={{ fontSize: 11 }}>
                  votre rendu · {fmtDate(sub.submitted_at)}
                </span>
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
                  {sub.content}
                </p>
              </div>
            ) : null}

            {graded ? (
              <div className="col" style={{ gap: 6 }}>
                <div className="row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <span className="pill on" data-testid="assignment-grade">
                    note · {Math.round((sub!.score as number) * 100)}/100
                  </span>
                </div>
                {sub!.feedback ? (
                  <p className="soft" style={{ fontSize: 13.5, margin: 0 }} data-testid="assignment-feedback">
                    <span className="kicker" style={{ marginRight: 8 }}>feedback</span>
                    {sub!.feedback}
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="col" style={{ gap: 8 }}>
                <label className="col" style={{ gap: 4 }}>
                  <span className="quiet mono" style={{ fontSize: 11 }}>
                    {sub ? "remplacer votre rendu (possible tant qu'il n'est pas noté)" : "votre rendu"}
                  </span>
                  <textarea
                    rows={4}
                    value={drafts[a.id] ?? ""}
                    onChange={(e) => setDrafts((d) => ({ ...d, [a.id]: e.target.value }))}
                    placeholder="Rédigez votre réponse ici…"
                    data-testid="assignment-content"
                  />
                </label>
                {errors[a.id] ? (
                  <p className="mono" style={{ color: "var(--alarm)", fontSize: 12, margin: 0 }}>
                    {errors[a.id]}
                  </p>
                ) : null}
                <div>
                  <button
                    type="button"
                    className="btn primary"
                    disabled={busyId === a.id}
                    onClick={() => void submit(a.id)}
                    data-testid="assignment-submit"
                  >
                    {busyId === a.id ? "Envoi…" : sub ? "Remplacer le rendu" : "Rendre le devoir"}
                  </button>
                </div>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
