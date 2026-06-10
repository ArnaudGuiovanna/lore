"use client";

// B-18 — annonces : message du formateur vers une cohorte ou tout
// l'organisme. Création, liste, archivage. Les apprenants voient les annonces
// de leur périmètre en tête de leur accueil.
import { useCallback, useEffect, useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { ErrorState, LoadingState } from "@/components/ui/States";
import type { Announcement } from "@/lib/types";

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

export function Announcements({ cohortId, cohortName }: { cohortId: string; cohortName: string }) {
  const [announcements, setAnnouncements] = useState<Announcement[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [scope, setScope] = useState(""); // "" = tout l'organisme

  const refresh = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch("/api/announcements");
      if (!res.ok) throw new Error(await readError(res));
      setAnnouncements(((await res.json()) as Announcement[]) ?? []);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "chargement impossible");
      setAnnouncements([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      if (!title.trim()) {
        setError("le titre est requis");
        return;
      }
      setBusy(true);
      try {
        const res = await fetch("/api/announcements", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, body, cohort_id: scope }),
        });
        if (!res.ok) throw new Error(await readError(res));
        setTitle("");
        setBody("");
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "publication impossible");
      } finally {
        setBusy(false);
      }
    },
    [title, body, scope, refresh]
  );

  const archive = useCallback(
    async (id: string) => {
      setBusy(true);
      try {
        await fetch(`/api/announcements/${encodeURIComponent(id)}`, { method: "DELETE" });
        await refresh();
      } finally {
        setBusy(false);
      }
    },
    [refresh]
  );

  const active = (announcements ?? []).filter((a) => !a.archived_at);

  return (
    <div className="col" style={{ gap: 22 }}>
      <Panel kicker="Annonces" title="Annonces publiées">
        {announcements === null ? (
          <LoadingState label="Chargement des annonces…" />
        ) : loadError && announcements.length === 0 ? (
          <ErrorState
            kicker="Les annonces n'ont pas répondu"
            detail="Les annonces persistées n'ont pas pu être lues — rien n'est inventé pour combler le manque."
            message={loadError}
            action={
              <button type="button" className="btn" onClick={() => void refresh()}>↺ réessayer</button>
            }
          />
        ) : active.length === 0 ? (
          <p className="quiet" style={{ fontSize: 14 }} data-testid="announcements-empty">
            Aucune annonce active — publiez la première ci-dessous.
          </p>
        ) : (
          <div className="col" style={{ gap: 12 }}>
            {active.map((a) => (
              <section key={a.id} className="panel col" style={{ gap: 8 }} data-testid="announcement-card" data-title={a.title}>
                <div className="spread" style={{ flexWrap: "wrap", gap: 10, alignItems: "baseline" }}>
                  <strong style={{ fontFamily: "var(--serif)", fontSize: 16 }}>{a.title}</strong>
                  <span className={`pill ${a.cohort_id ? "on" : ""}`}>
                    {a.cohort_id ? (a.cohort_id === cohortId ? cohortName : a.cohort_id.slice(0, 8)) : "tout l'organisme"}
                  </span>
                </div>
                {a.body ? (
                  <p className="soft" style={{ fontSize: 14, margin: 0, whiteSpace: "pre-wrap" }}>{a.body}</p>
                ) : null}
                <div className="spread" style={{ flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                  <span className="quiet mono" style={{ fontSize: 10.5 }}>publiée le {fmtDate(a.created_at)}</span>
                  <button
                    type="button"
                    className="btn ghost"
                    style={{ fontSize: 12 }}
                    disabled={busy}
                    onClick={() => void archive(a.id)}
                    data-testid="announcement-archive"
                  >
                    archiver
                  </button>
                </div>
              </section>
            ))}
          </div>
        )}
      </Panel>

      <Panel kicker="Nouvelle annonce" title="Publier une annonce">
        <form onSubmit={create} className="col" style={{ gap: 12, maxWidth: 620 }} aria-label="Publier une annonce">
          <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
            <label className="col" style={{ gap: 4, flex: 1, minWidth: 220 }}>
              <span className="quiet mono" style={{ fontSize: 11 }}>titre</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Rappel : atelier transactions jeudi"
                data-testid="announcement-title"
              />
            </label>
            <label className="col" style={{ gap: 4 }}>
              <span className="quiet mono" style={{ fontSize: 11 }}>destinataires</span>
              <select value={scope} onChange={(e) => setScope(e.target.value)} data-testid="announcement-scope">
                <option value="">tout l&apos;organisme</option>
                {cohortId ? <option value={cohortId}>{cohortName}</option> : null}
              </select>
            </label>
          </div>
          <label className="col" style={{ gap: 4 }}>
            <span className="quiet mono" style={{ fontSize: 11 }}>message</span>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
              data-testid="announcement-body"
            />
          </label>
          {error ? (
            <p className="mono" role="alert" style={{ color: "var(--alarm)", fontSize: 12 }}>{error}</p>
          ) : null}
          <div>
            <button type="submit" className="btn primary" disabled={busy} data-testid="announcement-publish">
              {busy ? "…" : "Publier l'annonce"}
            </button>
          </div>
        </form>
      </Panel>
    </div>
  );
}
