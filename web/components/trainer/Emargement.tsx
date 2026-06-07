"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/ui/Panel";

// A single learner the trainer can mark present/absent for the chosen session date.
export interface RosterEntry {
  learnerId: string;
  name: string;
  // Existing persisted presence for the selected date (null = not yet marked).
  present: boolean | null;
  signedAt: string | null;
}

export interface PastSession {
  sessionDate: string;
  present: number;
  absent: number;
  total: number;
}

function today(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

// fr-FR long date for display; tolerant of a bare YYYY-MM-DD.
function frDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  try {
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString("fr-FR", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

// Trainer émargement: pick a session date, mark each enrolled learner present/absent
// (saved per-row via POST /api/attendance), and download the feuille d'émargement PDF.
export function Emargement({
  cohortId,
  cohortName,
  initialDate,
  roster,
  pastSessions,
}: {
  cohortId: string;
  cohortName: string;
  initialDate: string;
  roster: RosterEntry[];
  pastSessions: PastSession[];
}) {
  const router = useRouter();
  const [date, setDate] = useState(initialDate || today());
  // Local presence overlay keyed by learnerId; seeded from the server-provided roster.
  const [marks, setMarks] = useState<Record<string, boolean | null>>(
    () => Object.fromEntries(roster.map((r) => [r.learnerId, r.present]))
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // When the date changes, navigate (server re-reads persisted presence for that day).
  function onDateChange(next: string) {
    setDate(next);
    setErr(null);
    const url = new URL(window.location.href);
    url.searchParams.set("date", next);
    router.push(`${url.pathname}?${url.searchParams.toString()}`);
  }

  async function mark(learnerId: string, present: boolean) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setErr("Choisissez une date de session valide.");
      return;
    }
    setBusy(learnerId);
    setErr(null);
    try {
      const res = await fetch("/api/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cohortId, sessionDate: date, learnerId, present }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErr(data?.error || `HTTP ${res.status}`);
        setBusy(null);
        return;
      }
      setMarks((m) => ({ ...m, [learnerId]: present }));
      setBusy(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "erreur réseau");
      setBusy(null);
    }
  }

  const presentCount = useMemo(
    () => Object.values(marks).filter((v) => v === true).length,
    [marks]
  );

  const sheetHref = `/api/attendance/sheet?cohort=${encodeURIComponent(cohortId)}&date=${encodeURIComponent(date)}`;
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date);

  return (
    <div className="col" style={{ gap: 22 }}>
      <p className="soft" style={{ maxWidth: "64ch", margin: 0 }}>
        L&apos;émargement est saisi ici par le formateur pour le groupe{" "}
        <strong>{cohortName}</strong>. Chaque présence enregistrée est horodatée
        (saisie numérique) ; la feuille d&apos;émargement PDF inclut une colonne
        signature pour un émargement manuscrit sur site.
      </p>

      <Panel
        kicker="Session"
        title="Choisir la date et marquer les présences"
        aside={
          <span className="mono quiet" style={{ fontSize: 11 }}>
            POST /api/attendance
          </span>
        }
      >
        <div className="row" style={{ gap: 16, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 18 }}>
          <div className="col" style={{ gap: 4 }}>
            <label className="kicker" htmlFor="emarg-date">Date de session</label>
            <input
              id="emarg-date"
              type="date"
              value={date}
              onChange={(e) => onDateChange(e.target.value)}
              style={{
                fontFamily: "var(--mono)",
                fontSize: 13,
                padding: "9px 12px",
                borderRadius: 10,
                border: "1px solid var(--line-2)",
                background: "var(--card)",
                color: "var(--ink)",
              }}
            />
          </div>
          <span className="mono quiet" style={{ fontSize: 12 }}>
            {validDate ? frDate(date) : "—"} · {presentCount}/{roster.length} présent(s)
          </span>
          <span className="spacer" style={{ flex: 1 }} />
          <a
            className="btn"
            href={validDate ? sheetHref : undefined}
            aria-disabled={!validDate}
            style={validDate ? { textDecoration: "none" } : { textDecoration: "none", opacity: 0.45, pointerEvents: "none" }}
          >
            Feuille d&apos;émargement (PDF) ↓
          </a>
        </div>

        {err ? (
          <p className="mono" role="alert" style={{ color: "var(--alarm)", fontSize: 13, marginBottom: 14 }}>
            {err}
          </p>
        ) : null}

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left" }}>
                <th className="kicker" style={{ padding: "8px 8px", borderBottom: "1px solid var(--line)" }}>Stagiaire</th>
                <th className="kicker" style={{ padding: "8px 8px", borderBottom: "1px solid var(--line)" }}>Présence</th>
                <th className="kicker" style={{ padding: "8px 8px", borderBottom: "1px solid var(--line)", textAlign: "right" }}>Marquer</th>
              </tr>
            </thead>
            <tbody>
              {roster.length === 0 ? (
                <tr>
                  <td colSpan={3} className="quiet" style={{ padding: "16px 8px" }}>
                    Aucun apprenant inscrit dans ce groupe.
                  </td>
                </tr>
              ) : (
                roster.map((r) => {
                  const state = marks[r.learnerId];
                  return (
                    <tr key={r.learnerId} style={{ borderBottom: "1px solid var(--line)" }}>
                      <td style={{ padding: "10px 8px", fontFamily: "var(--serif)", fontSize: 15, color: "var(--ink)" }}>
                        {r.name}
                        <span className="mono quiet" style={{ display: "block", fontSize: 10.5 }}>{r.learnerId}</span>
                      </td>
                      <td style={{ padding: "10px 8px" }}>
                        <span
                          className="mono"
                          style={{
                            fontSize: 12,
                            color:
                              state === true ? "var(--ink)" : state === false ? "var(--quiet)" : "var(--quiet)",
                          }}
                        >
                          {state === true ? "Présent" : state === false ? "Absent" : "non marqué"}
                        </span>
                      </td>
                      <td style={{ padding: "10px 8px", textAlign: "right" }}>
                        <span className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
                          <button
                            type="button"
                            className={`btn ${state === true ? "primary" : ""}`}
                            disabled={busy === r.learnerId || !validDate}
                            onClick={() => mark(r.learnerId, true)}
                            style={{ padding: "6px 12px", fontSize: 12 }}
                          >
                            {busy === r.learnerId ? "…" : "Présent"}
                          </button>
                          <button
                            type="button"
                            className="btn"
                            disabled={busy === r.learnerId || !validDate}
                            onClick={() => mark(r.learnerId, false)}
                            style={{ padding: "6px 12px", fontSize: 12 }}
                          >
                            Absent
                          </button>
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel kicker="Historique" title="Sessions émargées">
        {pastSessions.length === 0 ? (
          <p className="quiet" style={{ margin: 0 }}>Aucune session émargée pour l&apos;instant.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left" }}>
                  <th className="kicker" style={{ padding: "8px 8px", borderBottom: "1px solid var(--line)" }}>Date</th>
                  <th className="kicker" style={{ padding: "8px 8px", borderBottom: "1px solid var(--line)" }}>Présents</th>
                  <th className="kicker" style={{ padding: "8px 8px", borderBottom: "1px solid var(--line)" }}>Absents</th>
                  <th className="kicker" style={{ padding: "8px 8px", borderBottom: "1px solid var(--line)", textAlign: "right" }}>Feuille</th>
                </tr>
              </thead>
              <tbody>
                {pastSessions.map((sess) => (
                  <tr key={sess.sessionDate} style={{ borderBottom: "1px solid var(--line)" }}>
                    <td style={{ padding: "10px 8px", fontFamily: "var(--serif)", fontSize: 15 }}>{frDate(sess.sessionDate)}</td>
                    <td className="mono" style={{ padding: "10px 8px", fontSize: 13 }}>{sess.present}</td>
                    <td className="mono quiet" style={{ padding: "10px 8px", fontSize: 13 }}>{sess.absent}</td>
                    <td style={{ padding: "10px 8px", textAlign: "right" }}>
                      <a
                        className="mono"
                        style={{ fontSize: 12, textDecoration: "underline" }}
                        href={`/api/attendance/sheet?cohort=${encodeURIComponent(cohortId)}&date=${encodeURIComponent(sess.sessionDate)}`}
                      >
                        PDF ↓
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
