"use client";

// B-08 — profil légal de l'OF (raison sociale, SIRET, NDA…) + export Qualiopi
// d'une cohorte. Le profil vit dans le JSON `profile` du tenant (clés
// snake_case) ; l'export est le bundle JSON canonique du backend.
import { useCallback, useEffect, useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { ErrorState, LoadingState } from "@/components/ui/States";
import type { TenantProfile } from "@/lib/types";
import type { NamedRef } from "./Conformite";

const FIELDS: { key: string; label: string; placeholder: string; wide?: boolean }[] = [
  { key: "raison_sociale", label: "Raison sociale", placeholder: "Acme Learning SAS", wide: true },
  { key: "siret", label: "SIRET", placeholder: "123 456 789 00012" },
  { key: "nda", label: "N° de déclaration d'activité (NDA)", placeholder: "11 75 12345 75" },
  { key: "adresse", label: "Adresse", placeholder: "12 rue de la Formation", wide: true },
  { key: "ville", label: "Ville", placeholder: "Paris" },
  { key: "code_postal", label: "Code postal", placeholder: "75011" },
  { key: "representant", label: "Représentant (signataire)", placeholder: "S. Aalto" },
  { key: "telephone", label: "Téléphone", placeholder: "01 23 45 67 89" },
  { key: "email", label: "E-mail", placeholder: "contact@acme.test" },
];

function downloadJSON(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function ProfilOF({ cohorts }: { cohorts: NamedRef[] }) {
  const [values, setValues] = useState<Record<string, string> | null>(null);
  const [tenantName, setTenantName] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [exportCohort, setExportCohort] = useState(cohorts[0]?.id ?? "");
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch("/api/admin/conformite/profile");
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as TenantProfile;
      setTenantName(data.name || "");
      const next: Record<string, string> = {};
      for (const f of FIELDS) {
        const v = data.profile?.[f.key];
        next[f.key] = typeof v === "string" ? v : v == null ? "" : String(v);
      }
      setValues(next);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "chargement impossible");
      setValues(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!values) return;
      setBusy(true);
      setError(null);
      setSaved(false);
      try {
        const profile: Record<string, string> = {};
        for (const f of FIELDS) {
          if ((values[f.key] ?? "").trim() !== "") profile[f.key] = values[f.key].trim();
        }
        const res = await fetch("/api/admin/conformite/profile", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ profile }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        setSaved(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "enregistrement impossible");
      } finally {
        setBusy(false);
      }
    },
    [values]
  );

  const exportQualiopi = useCallback(async () => {
    if (!exportCohort) return;
    setExportBusy(true);
    setExportError(null);
    try {
      const res = await fetch(
        `/api/admin/conformite/qualiopi?cohortId=${encodeURIComponent(exportCohort)}`
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const bundle = (await res.json()) as Record<string, unknown>;
      const cohortName = cohorts.find((c) => c.id === exportCohort)?.name ?? exportCohort.slice(0, 8);
      downloadJSON(`qualiopi-${cohortName}.json`, bundle);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : "export impossible");
    } finally {
      setExportBusy(false);
    }
  }, [exportCohort, cohorts]);

  return (
    <div className="col" style={{ gap: 22 }}>
      <Panel
        kicker="Profil légal"
        title={`Identité de l'organisme${tenantName ? ` · ${tenantName}` : ""}`}
        aside={<span className="mono quiet" style={{ fontSize: 11 }}>GET/PUT /profile</span>}
      >
        {values === null && !loadError ? (
          <LoadingState label="Chargement du profil…" />
        ) : loadError ? (
          <ErrorState
            kicker="Le profil n'a pas répondu"
            detail="Le profil de l'organisme n'a pas pu être lu — rien n'est inventé pour combler le manque."
            message={loadError}
            action={
              <button type="button" className="btn" onClick={() => void refresh()}>
                ↺ réessayer
              </button>
            }
          />
        ) : (
          <form onSubmit={save} className="col" style={{ gap: 12, maxWidth: 640 }} data-testid="of-profile-form">
            <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
              {FIELDS.map((f) => (
                <label
                  key={f.key}
                  className="col"
                  style={{ gap: 4, flex: f.wide ? "1 1 100%" : "1 1 calc(33% - 12px)", minWidth: 180 }}
                >
                  <span className="quiet mono" style={{ fontSize: 11 }}>{f.label}</span>
                  <input
                    value={values?.[f.key] ?? ""}
                    onChange={(e) =>
                      setValues((v) => ({ ...(v ?? {}), [f.key]: e.target.value }))
                    }
                    placeholder={f.placeholder}
                    data-testid={`of-profile-${f.key}`}
                  />
                </label>
              ))}
            </div>
            {error ? (
              <p className="mono" style={{ color: "var(--alarm)", fontSize: 12, margin: 0 }}>{error}</p>
            ) : null}
            <div className="row" style={{ gap: 12, alignItems: "center" }}>
              <button type="submit" className="btn primary" disabled={busy} data-testid="of-profile-save">
                {busy ? "Enregistrement…" : "Enregistrer le profil"}
              </button>
              {saved ? (
                <span className="pill on" data-testid="of-profile-saved">profil enregistré</span>
              ) : null}
            </div>
          </form>
        )}
      </Panel>

      <Panel
        kicker="Qualiopi"
        title="Export de preuves d'une cohorte"
        aside={<span className="mono quiet" style={{ fontSize: 11 }}>GET /cohorts/…/qualiopi-export</span>}
      >
        <div className="col" style={{ gap: 12, maxWidth: 560 }}>
          <p className="soft" style={{ margin: 0, fontSize: 14, lineHeight: 1.6 }}>
            Le bundle JSON assemble l&apos;identité de l&apos;organisme, les sessions, la
            progression et les heures par apprenant, les agrégats de satisfaction et le
            registre des réclamations — la donnée canonique pour l&apos;audit.
          </p>
          <div className="row" style={{ gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
            <label className="col" style={{ gap: 4 }}>
              <span className="quiet mono" style={{ fontSize: 11 }}>cohorte</span>
              <select
                value={exportCohort}
                onChange={(e) => setExportCohort(e.target.value)}
                data-testid="qualiopi-cohort"
              >
                {cohorts.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="btn"
              disabled={exportBusy || !exportCohort}
              onClick={() => void exportQualiopi()}
              data-testid="qualiopi-download"
            >
              {exportBusy ? "Préparation…" : "↓ Télécharger l'export de preuves (JSON)"}
            </button>
          </div>
          {exportError ? (
            <p className="mono" style={{ color: "var(--alarm)", fontSize: 12, margin: 0 }}>{exportError}</p>
          ) : null}
        </div>
      </Panel>
    </div>
  );
}
