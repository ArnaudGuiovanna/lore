"use client";

// B-28 — bannière de consentement : au chargement de l'espace apprenant, on
// compare les textes légaux publiés (dernière version par kind) avec les
// consentements de l'apprenant. Tout texte non consenti dans sa version
// courante apparaît ici, avec lecture en place et « J'accepte » par texte.
// Bannière persistante en haut — jamais un mur bloquant.
import { useCallback, useEffect, useState } from "react";
import type { Consent, LegalText } from "@/lib/types";

const KIND_FR: Record<string, string> = {
  CGU: "Conditions générales d'utilisation",
  CONFIDENTIALITE: "Politique de confidentialité",
  MENTIONS: "Mentions légales",
};

export function ConsentBanner() {
  const [pending, setPending] = useState<LegalText[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/learner/legal");
      if (!res.ok) {
        // Lecture impossible → pas de bannière inventée ; on reste silencieux.
        setPending([]);
        return;
      }
      const data = (await res.json()) as { texts: LegalText[]; consents: Consent[] };
      const consented = new Set((data.consents ?? []).map((c) => c.legal_text_id));
      setPending((data.texts ?? []).filter((t) => !consented.has(t.id)));
    } catch {
      setPending([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const accept = useCallback(
    async (text: LegalText) => {
      setBusyId(text.id);
      setError(null);
      try {
        const res = await fetch("/api/learner/consents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ legal_text_id: text.id }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "enregistrement impossible");
      } finally {
        setBusyId(null);
      }
    },
    [refresh]
  );

  if (!pending || pending.length === 0) return null;

  return (
    <section
      className="panel col"
      role="region"
      aria-label="Consentement requis"
      data-testid="consent-banner"
      style={{ gap: 10, borderColor: "var(--amber)", marginBottom: 18 }}
    >
      <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <span className="mark">consentement requis</span>
        <span className="soft" style={{ fontSize: 13.5 }}>
          De nouveaux textes légaux ont été publiés — merci d&apos;en prendre connaissance.
          Vous pouvez continuer à apprendre pendant ce temps.
        </span>
      </div>
      <ul className="col" style={{ gap: 8, margin: 0, padding: 0, listStyle: "none" }}>
        {pending.map((t) => (
          <li key={t.id} className="col" style={{ gap: 8 }}>
            <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontFamily: "var(--serif)", fontSize: 14.5 }}>
                {KIND_FR[t.kind] ?? t.kind} <span className="mono quiet" style={{ fontSize: 11 }}>v{t.version}</span>
              </span>
              <button
                type="button"
                className="btn ghost"
                style={{ fontSize: 12 }}
                onClick={() => setOpenId(openId === t.id ? null : t.id)}
                data-testid={`consent-read-${t.kind}`}
              >
                {openId === t.id ? "fermer" : "lire le texte"}
              </button>
              <button
                type="button"
                className="btn primary"
                style={{ fontSize: 12, padding: "6px 12px" }}
                disabled={busyId === t.id}
                onClick={() => void accept(t)}
                data-testid={`consent-accept-${t.kind}`}
              >
                {busyId === t.id ? "…" : "J'accepte"}
              </button>
            </div>
            {openId === t.id ? (
              <pre
                className="mono"
                style={{
                  fontSize: 12,
                  whiteSpace: "pre-wrap",
                  background: "var(--paper)",
                  border: "1px solid var(--line)",
                  borderRadius: 8,
                  padding: "10px 12px",
                  margin: 0,
                  maxHeight: 240,
                  overflowY: "auto",
                }}
              >
                {t.body}
              </pre>
            ) : null}
          </li>
        ))}
      </ul>
      {error ? (
        <p className="mono" style={{ color: "var(--alarm)", fontSize: 12, margin: 0 }}>{error}</p>
      ) : null}
    </section>
  );
}
