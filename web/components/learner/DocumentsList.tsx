"use client";

// B-10 — « Documents » côté apprenant : SES documents contractuels (le backend
// filtre par jeton : adressés à lui, à ses cohortes actives, ou au tenant).
// Lecture du contenu en place — pas de mutation possible ici.
import { useCallback, useEffect, useState } from "react";
import { ErrorState, LoadingState } from "@/components/ui/States";
import type { OFDocument } from "@/lib/types";

const KIND_FR: Record<string, string> = {
  CONVENTION: "Convention de formation",
  CONTRAT: "Contrat de formation",
  DEVIS: "Devis",
  PROGRAMME: "Programme de formation",
  REGLEMENT_INTERIEUR: "Règlement intérieur",
  AUTRE: "Document",
};

function fmtDate(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("fr-FR", { dateStyle: "long" });
}

export function DocumentsList() {
  const [documents, setDocuments] = useState<OFDocument[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch("/api/learner/documents");
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setDocuments(((await res.json()) as OFDocument[]) ?? []);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "chargement impossible");
      setDocuments([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (documents === null) return <LoadingState label="Chargement de vos documents…" />;

  if (loadError && documents.length === 0) {
    return (
      <ErrorState
        kicker="Vos documents n'ont pas répondu"
        detail="Nous n'avons pas pu lire vos documents — rien n'est inventé pour combler le manque. Ils ne sont pas perdus : ceci n'est qu'une lecture."
        message={loadError}
        action={
          <button type="button" className="btn" onClick={() => void refresh()}>
            ↺ réessayer
          </button>
        }
      />
    );
  }

  if (documents.length === 0) {
    return (
      <section className="panel col" style={{ gap: 10 }} data-testid="learner-docs-empty">
        <span className="kicker">Aucun document pour l&apos;instant</span>
        <p className="soft" style={{ maxWidth: "58ch", fontSize: 15, lineHeight: 1.6 }}>
          Votre organisme de formation n&apos;a pas encore publié de document vous
          concernant (convention, programme, règlement intérieur…). Ils apparaîtront ici.
        </p>
      </section>
    );
  }

  return (
    <div className="col" style={{ gap: 14 }}>
      {documents.map((d) => {
        const open = openId === d.id;
        return (
          <section key={d.id} className="panel col" style={{ gap: 10 }} data-testid="learner-doc-card" data-title={d.title}>
            <div className="spread" style={{ flexWrap: "wrap", gap: 10, alignItems: "baseline" }}>
              <h2 style={{ fontSize: 19 }}>{d.title}</h2>
              <span className="pill">{KIND_FR[d.kind] ?? d.kind}</span>
            </div>
            <p className="mono quiet" style={{ fontSize: 11, margin: 0 }}>
              version {d.version} · {fmtDate(d.created_at)}
            </p>
            <div>
              <button
                type="button"
                className="btn ghost"
                style={{ fontSize: 12 }}
                onClick={() => setOpenId(open ? null : d.id)}
                data-testid="learner-doc-toggle"
              >
                {open ? "fermer" : "lire le document"}
              </button>
            </div>
            {open ? (
              <pre
                className="mono"
                data-testid="learner-doc-body"
                style={{
                  fontSize: 12.5,
                  whiteSpace: "pre-wrap",
                  background: "var(--paper)",
                  border: "1px solid var(--line)",
                  borderRadius: 8,
                  padding: "12px 14px",
                  margin: 0,
                }}
              >
                {d.body || "(document sans contenu)"}
              </pre>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
