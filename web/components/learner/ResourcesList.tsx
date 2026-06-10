"use client";

// B-17 — « Ressources » côté apprenant : les supports partagés dans SON
// périmètre (ses cohortes + tout l'organisme, filtré par le jeton). Fichier →
// téléchargement streamé par le proxy ; lien → ouverture dans un nouvel onglet.
import { useCallback, useEffect, useState } from "react";
import { ErrorState, LoadingState } from "@/components/ui/States";
import type { Resource } from "@/lib/types";

function fmtDate(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("fr-FR", { dateStyle: "long" });
}

function fmtSize(bytes: number): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Kio`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mio`;
}

export function ResourcesList() {
  const [resources, setResources] = useState<Resource[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch("/api/learner/resources");
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setResources(((await res.json()) as Resource[]) ?? []);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "chargement impossible");
      setResources([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (resources === null) return <LoadingState label="Chargement de vos ressources…" />;

  if (loadError && resources.length === 0) {
    return (
      <ErrorState
        kicker="Vos ressources n'ont pas répondu"
        detail="Nous n'avons pas pu lire vos ressources — rien n'est inventé pour combler le manque. Elles ne sont pas perdues : ceci n'est qu'une lecture."
        message={loadError}
        action={
          <button type="button" className="btn" onClick={() => void refresh()}>
            ↺ réessayer
          </button>
        }
      />
    );
  }

  const active = resources.filter((r) => !r.archived_at);

  if (active.length === 0) {
    return (
      <section className="panel col" style={{ gap: 10 }} data-testid="learner-resources-empty">
        <span className="kicker">Aucune ressource pour l&apos;instant</span>
        <p className="soft" style={{ maxWidth: "58ch", fontSize: 15, lineHeight: 1.6 }}>
          Votre formateur n&apos;a pas encore partagé de support (fichier ou lien) avec votre
          groupe. Les ressources apparaîtront ici dès leur publication.
        </p>
      </section>
    );
  }

  return (
    <div className="col" style={{ gap: 14 }}>
      {active.map((r) => (
        <section key={r.id} className="panel col" style={{ gap: 10 }} data-testid="learner-resource-card" data-title={r.title}>
          <div className="spread" style={{ flexWrap: "wrap", gap: 10, alignItems: "baseline" }}>
            <h2 style={{ fontSize: 19 }}>{r.title}</h2>
            <span className="pill">
              {r.kind === "LIEN" ? "lien externe" : r.mime_type || "fichier"}
            </span>
          </div>
          {r.description ? (
            <p className="soft" style={{ fontSize: 14, margin: 0 }}>{r.description}</p>
          ) : null}
          <p className="mono quiet" style={{ fontSize: 11, margin: 0 }}>
            {r.kind === "FICHIER" && r.size_bytes > 0 ? `${fmtSize(r.size_bytes)} · ` : ""}
            partagée le {fmtDate(r.created_at)}
          </p>
          <div>
            <a
              className="btn ghost"
              style={{ fontSize: 12, textDecoration: "none" }}
              href={`/api/resources/${encodeURIComponent(r.id)}/download`}
              target={r.kind === "LIEN" ? "_blank" : undefined}
              rel={r.kind === "LIEN" ? "noreferrer" : undefined}
              data-testid="learner-resource-download"
            >
              {r.kind === "LIEN" ? "ouvrir le lien ↗" : "↓ télécharger"}
            </a>
          </div>
        </section>
      ))}
    </div>
  );
}
