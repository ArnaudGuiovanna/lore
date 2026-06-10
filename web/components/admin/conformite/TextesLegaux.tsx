"use client";

// B-28 — textes légaux versionnés (CGU, politique de confidentialité, mentions
// légales) + registre des consentements. Publier crée la version max+1 sans
// effacer l'historique : chaque consentement pointe la version exacte acceptée.
import { useCallback, useEffect, useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { ErrorState, LoadingState } from "@/components/ui/States";
import type { Consent, LegalText, LegalTextKind } from "@/lib/types";
import type { NamedRef } from "./Conformite";

const KIND_FR: Record<LegalTextKind, string> = {
  CGU: "Conditions générales d'utilisation",
  CONFIDENTIALITE: "Politique de confidentialité",
  MENTIONS: "Mentions légales",
};

type ConsentRow = Consent & Record<string, unknown>;
type HistoryRow = LegalText & Record<string, unknown>;

function fmtDate(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" });
}

export function TextesLegaux({ people }: { people: NamedRef[] }) {
  const [texts, setTexts] = useState<LegalText[] | null>(null);
  const [consents, setConsents] = useState<Consent[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [published, setPublished] = useState<LegalText | null>(null);

  const [form, setForm] = useState({ kind: "CGU" as LegalTextKind, body: "" });
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<LegalText[] | null>(null);

  const refresh = useCallback(async () => {
    setLoadError(null);
    try {
      const [textsRes, consentsRes] = await Promise.all([
        fetch("/api/admin/conformite/legal-texts"),
        fetch("/api/admin/conformite/consents"),
      ]);
      if (!textsRes.ok) throw new Error(`textes · HTTP ${textsRes.status}`);
      if (!consentsRes.ok) throw new Error(`consentements · HTTP ${consentsRes.status}`);
      setTexts(((await textsRes.json()) as LegalText[]) ?? []);
      setConsents(((await consentsRes.json()) as Consent[]) ?? []);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "chargement impossible");
      setTexts([]);
      setConsents([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/conformite/legal-texts?history=1");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setHistory(((await res.json()) as LegalText[]) ?? []);
    } catch {
      setHistory([]);
    }
  }, []);

  const publish = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!form.body.trim()) {
        setError("le texte est requis");
        return;
      }
      setBusy(true);
      setError(null);
      setPublished(null);
      try {
        const res = await fetch("/api/admin/conformite/legal-texts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: form.kind, body: form.body }),
        });
        const data = (await res.json().catch(() => ({}))) as LegalText & { error?: string };
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        setPublished(data);
        setForm((f) => ({ ...f, body: "" }));
        await refresh();
        if (showHistory) await loadHistory();
      } catch (err) {
        setError(err instanceof Error ? err.message : "publication impossible");
      } finally {
        setBusy(false);
      }
    },
    [form, refresh, showHistory, loadHistory]
  );

  const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? id.slice(0, 8);

  const currentByKind = (kind: LegalTextKind) => (texts ?? []).find((t) => t.kind === kind);

  const consentColumns: Column<ConsentRow>[] = [
    { key: "user_id", header: "Utilisateur", render: (r) => <span data-testid="consent-user">{nameOf(r.user_id)}</span> },
    { key: "kind", header: "Texte", render: (r) => <span>{KIND_FR[r.kind as LegalTextKind] ?? r.kind}</span> },
    { key: "version", header: "Version", align: "right", mono: true, render: (r) => <span>v{r.version}</span> },
    { key: "consented_at", header: "Accepté le", mono: true, render: (r) => <span>{fmtDate(r.consented_at)}</span> },
  ];

  const historyColumns: Column<HistoryRow>[] = [
    { key: "kind", header: "Texte", render: (r) => <span>{KIND_FR[r.kind] ?? r.kind}</span> },
    { key: "version", header: "Version", align: "right", mono: true, render: (r) => <span>v{r.version}</span> },
    { key: "published_at", header: "Publié le", mono: true, render: (r) => <span>{fmtDate(r.published_at)}</span> },
    {
      key: "body",
      header: "Extrait",
      render: (r) => (
        <span className="quiet" style={{ fontSize: 12 }}>
          {r.body.length > 80 ? `${r.body.slice(0, 80)}…` : r.body}
        </span>
      ),
    },
  ];

  return (
    <div className="col" style={{ gap: 22 }}>
      <Panel
        kicker="Textes légaux"
        title="Versions en vigueur"
        aside={
          <button
            type="button"
            className="btn ghost"
            style={{ fontSize: 12 }}
            onClick={() => {
              const next = !showHistory;
              setShowHistory(next);
              if (next && history === null) void loadHistory();
            }}
          >
            {showHistory ? "masquer l'historique" : "historique des versions"}
          </button>
        }
      >
        {texts === null ? (
          <LoadingState label="Chargement des textes…" />
        ) : loadError ? (
          <ErrorState
            kicker="Les textes n'ont pas répondu"
            detail="Les textes légaux n'ont pas pu être lus — rien n'est inventé pour combler le manque."
            message={loadError}
            action={
              <button type="button" className="btn" onClick={() => void refresh()}>
                ↺ réessayer
              </button>
            }
          />
        ) : (
          <div className="col" style={{ gap: 10 }}>
            {(Object.keys(KIND_FR) as LegalTextKind[]).map((kind) => {
              const current = currentByKind(kind);
              return (
                <div key={kind} className="spread" style={{ gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                  <span style={{ fontFamily: "var(--serif)", fontSize: 15 }}>{KIND_FR[kind]}</span>
                  {current ? (
                    <span className="row" style={{ gap: 10, alignItems: "center" }}>
                      <span className="pill on">v{current.version}</span>
                      <span className="quiet mono" style={{ fontSize: 11 }}>{fmtDate(current.published_at)}</span>
                      <button
                        type="button"
                        className="btn ghost"
                        style={{ fontSize: 12 }}
                        onClick={() => setForm({ kind, body: current.body })}
                      >
                        éditer → nouvelle version
                      </button>
                    </span>
                  ) : (
                    <span className="quiet mono" style={{ fontSize: 11 }}>jamais publié</span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {showHistory ? (
          history === null ? (
            <div style={{ marginTop: 14 }}>
              <LoadingState label="Chargement de l'historique…" />
            </div>
          ) : (
            <div style={{ marginTop: 14 }}>
              <DataTable<HistoryRow>
                columns={historyColumns}
                rows={(history as HistoryRow[]) ?? []}
                rowKey={(r) => r.id}
                empty="Aucune version publiée."
              />
            </div>
          )
        ) : null}
      </Panel>

      <Panel kicker="Publication" title="Publier une nouvelle version">
        <form onSubmit={publish} className="col" style={{ gap: 12, maxWidth: 680 }} data-testid="legal-publish-form">
          <label className="col" style={{ gap: 4, maxWidth: 340 }}>
            <span className="quiet mono" style={{ fontSize: 11 }}>texte</span>
            <select
              value={form.kind}
              onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as LegalTextKind }))}
              data-testid="legal-kind"
            >
              {(Object.keys(KIND_FR) as LegalTextKind[]).map((k) => (
                <option key={k} value={k}>{KIND_FR[k]}</option>
              ))}
            </select>
          </label>
          <label className="col" style={{ gap: 4 }}>
            <span className="quiet mono" style={{ fontSize: 11 }}>
              contenu (publier remplace la version en vigueur ; l&apos;historique est conservé)
            </span>
            <textarea
              rows={8}
              value={form.body}
              onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
              placeholder="Texte intégral…"
              data-testid="legal-body"
            />
          </label>
          {error ? (
            <p className="mono" style={{ color: "var(--alarm)", fontSize: 12, margin: 0 }}>{error}</p>
          ) : null}
          <div className="row" style={{ gap: 12, alignItems: "center" }}>
            <button type="submit" className="btn primary" disabled={busy} data-testid="legal-publish-submit">
              {busy ? "…" : "Publier"}
            </button>
            {published ? (
              <span className="pill on" data-testid="legal-published">
                {KIND_FR[published.kind] ?? published.kind} · v{published.version} publiée
              </span>
            ) : null}
          </div>
        </form>
      </Panel>

      <Panel
        kicker="Consentements"
        title="Registre des consentements"
        aside={<span className="mono quiet" style={{ fontSize: 11 }}>chaque ligne pointe la version exacte acceptée</span>}
      >
        {consents === null ? (
          <LoadingState label="Chargement du registre…" />
        ) : (
          <DataTable<ConsentRow>
            columns={consentColumns}
            rows={(consents as ConsentRow[]) ?? []}
            rowKey={(r) => r.id}
            empty="Aucun consentement enregistré — les apprenants verront la bannière au prochain accès."
          />
        )}
      </Panel>
    </div>
  );
}
