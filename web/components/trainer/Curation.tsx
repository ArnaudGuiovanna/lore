"use client";

// B-16 — file de curation : le formateur relit ce que le LLM a réellement
// enseigné (contenu généré, provenance provider/modèle) et tranche : approuvé
// ou rejeté (avec note). Un contenu REJECTED disparaît des lectures persistées.
import { useCallback, useEffect, useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { ErrorState, LoadingState } from "@/components/ui/States";
import { SourceMark } from "@/components/runtime/SourceMark";
import type { GeneratedContent, ReviewStatus } from "@/lib/types";

const STATUS_TABS: { id: ReviewStatus; label: string }[] = [
  { id: "PENDING_REVIEW", label: "En attente" },
  { id: "APPROVED", label: "Approuvés" },
  { id: "REJECTED", label: "Rejetés" },
];

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

export function Curation() {
  const [status, setStatus] = useState<ReviewStatus>("PENDING_REVIEW");
  const [contents, setContents] = useState<GeneratedContent[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  // Note de relecture par contenu (jointe au verdict, surtout au rejet).
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [openId, setOpenId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch(`/api/trainer/content-review?status=${encodeURIComponent(status)}`);
      if (!res.ok) throw new Error(await readError(res));
      setContents(((await res.json()) as GeneratedContent[]) ?? []);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "chargement impossible");
      setContents([]);
    }
  }, [status]);

  useEffect(() => {
    setContents(null);
    void refresh();
  }, [refresh]);

  const review = useCallback(
    async (id: string, verdict: "APPROVED" | "REJECTED") => {
      setError(null);
      const note = (notes[id] || "").trim();
      if (verdict === "REJECTED" && !note) {
        setError("un rejet demande une note — dites pourquoi ce contenu ne doit plus être servi");
        return;
      }
      setPending(id);
      try {
        const res = await fetch(`/api/trainer/content-review/${encodeURIComponent(id)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: verdict, note }),
        });
        if (!res.ok) throw new Error(await readError(res));
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "verdict impossible");
      } finally {
        setPending(null);
      }
    },
    [notes, refresh]
  );

  return (
    <Panel
      kicker="Curation · contenus générés"
      title="Relisez ce que le LLM a enseigné"
      aside={
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }} role="tablist" aria-label="Filtre de statut de relecture">
          {STATUS_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={status === t.id}
              className={`pill ${status === t.id ? "on" : ""}`}
              style={{ cursor: "pointer" }}
              onClick={() => setStatus(t.id)}
              data-testid={`curation-tab-${t.id}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      }
    >
      <p className="soft" style={{ marginTop: -6, marginBottom: 18, maxWidth: "62ch" }}>
        Chaque contenu généré porte sa provenance (fournisseur / modèle). Approuvez ce qui est juste ;
        rejetez ce qui ne doit plus être servi — un contenu rejeté disparaît des lectures.
      </p>

      {error ? (
        <p className="mono" role="alert" style={{ color: "var(--alarm)", fontSize: 12.5, marginBottom: 14 }}>{error}</p>
      ) : null}

      {contents === null ? (
        <LoadingState label="Chargement de la file de curation…" />
      ) : loadError && contents.length === 0 ? (
        <ErrorState
          kicker="La file de curation n'a pas répondu"
          detail="Les contenus générés n'ont pas pu être lus — rien n'est inventé pour combler le manque."
          message={loadError}
          action={
            <button type="button" className="btn" onClick={() => void refresh()}>↺ réessayer</button>
          }
        />
      ) : contents.length === 0 ? (
        <p className="quiet" style={{ fontSize: 14 }} data-testid="curation-empty">
          {status === "PENDING_REVIEW"
            ? "Rien à relire : aucun contenu généré n'attend de verdict. La file se remplit dès que le LLM rédige pour vos apprenants."
            : status === "APPROVED"
              ? "Aucun contenu approuvé pour l'instant."
              : "Aucun contenu rejeté pour l'instant."}
        </p>
      ) : (
        <div className="col" style={{ gap: 14 }}>
          {contents.map((c) => {
            const open = openId === c.id;
            const decided = c.review_status === "APPROVED" || c.review_status === "REJECTED";
            return (
              <section key={c.id} className="panel col" style={{ gap: 10 }} data-testid="curation-card">
                <div className="spread" style={{ flexWrap: "wrap", gap: 10, alignItems: "center" }}>
                  <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                    <SourceMark
                      source={c.provider === "instruction_only" ? "fallbk" : "llm"}
                      detail={`${c.provider}/${c.model}`}
                    />
                    <span className="mono quiet" style={{ fontSize: 11 }}>
                      généré le {fmtDate(c.created_at)} · instruction {c.instruction_id.slice(0, 8)}
                    </span>
                  </div>
                  {decided ? (
                    <span className={`pill ${c.review_status === "APPROVED" ? "on" : ""}`} data-testid="curation-status">
                      {c.review_status === "APPROVED" ? "approuvé" : "rejeté"}
                      {c.reviewed_at ? ` · ${fmtDate(c.reviewed_at)}` : ""}
                    </span>
                  ) : (
                    <span className="pill">en attente</span>
                  )}
                </div>

                <pre
                  className="mono"
                  style={{
                    fontSize: 12.5,
                    whiteSpace: "pre-wrap",
                    background: "var(--paper)",
                    border: "1px solid var(--line)",
                    borderRadius: 8,
                    padding: "12px 14px",
                    margin: 0,
                    maxHeight: open ? "none" : 180,
                    overflow: "hidden",
                  }}
                  data-testid="curation-body"
                >
                  {c.content || "(contenu vide)"}
                </pre>
                {(c.content || "").length > 400 ? (
                  <button
                    type="button"
                    className="btn ghost"
                    style={{ alignSelf: "flex-start", fontSize: 12 }}
                    onClick={() => setOpenId(open ? null : c.id)}
                  >
                    {open ? "replier" : "lire en entier"}
                  </button>
                ) : null}

                {decided && c.review_note ? (
                  <p className="soft" style={{ fontSize: 13, margin: 0 }}>
                    <span className="kicker" style={{ marginRight: 8 }}>note</span>
                    {c.review_note}
                  </p>
                ) : null}

                {!decided ? (
                  <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
                    <label className="col" style={{ gap: 4, flex: 1, minWidth: 240 }}>
                      <span className="quiet mono" style={{ fontSize: 11 }}>note (obligatoire au rejet)</span>
                      <input
                        value={notes[c.id] || ""}
                        onChange={(e) => setNotes((n) => ({ ...n, [c.id]: e.target.value }))}
                        placeholder="ex. : analogie trompeuse sur les transactions"
                        data-testid="curation-note"
                      />
                    </label>
                    <button
                      type="button"
                      className="btn primary"
                      disabled={pending === c.id}
                      onClick={() => void review(c.id, "APPROVED")}
                      data-testid="curation-approve"
                    >
                      {pending === c.id ? "…" : "Approuver"}
                    </button>
                    <button
                      type="button"
                      className="btn"
                      disabled={pending === c.id}
                      onClick={() => void review(c.id, "REJECTED")}
                      data-testid="curation-reject"
                    >
                      {pending === c.id ? "…" : "Rejeter"}
                    </button>
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
      )}
    </Panel>
  );
}
