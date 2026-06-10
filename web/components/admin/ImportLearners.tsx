"use client";

import { useCallback, useState } from "react";
import { Panel } from "@/components/ui/Panel";
import type { ManagedProgram } from "./types";

interface RowResult {
  line: number;
  email: string;
  name: string;
  status: "created" | "exists" | "error";
  tempPassword?: string;
  enrolled?: boolean;
  emailed?: boolean;
  error?: string;
}

interface ImportResponse {
  total: number;
  created: number;
  existing: number;
  results: RowResult[];
  error?: string;
}

// Mass CSV import (B-12/B-23): paste or upload "nom,email" rows, optionally
// enroll into a cohort and email credentials. Results are shown per row and
// downloadable (temp passwords are revealed exactly once).
export function ImportLearners({ programs }: { programs: ManagedProgram[] }) {
  const cohorts = programs.flatMap((p) => p.cohorts);
  const [csv, setCsv] = useState("");
  const [cohortId, setCohortId] = useState(cohorts[0]?.id ?? "");
  const [sendEmails, setSendEmails] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ImportResponse | null>(null);

  const onFile = useCallback(async (file: File | undefined) => {
    if (!file) return;
    setCsv(await file.text());
  }, []);

  const run = useCallback(async () => {
    if (!csv.trim()) {
      setError("collez ou chargez un CSV (colonnes nom,email)");
      return;
    }
    setBusy(true);
    setError(null);
    setReport(null);
    try {
      const res = await fetch("/api/admin/import-learners", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv, cohortId: cohortId || undefined, sendEmails }),
      });
      const body = (await res.json()) as ImportResponse;
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setReport(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : "import impossible");
    } finally {
      setBusy(false);
    }
  }, [csv, cohortId, sendEmails]);

  const downloadReport = useCallback(() => {
    if (!report) return;
    const lines = [
      "ligne;email;nom;statut;mot_de_passe_temporaire;inscrit;email_envoye;erreur",
      ...report.results.map((r) =>
        [r.line, r.email, r.name, r.status, r.tempPassword ?? "", r.enrolled ? "oui" : "", r.emailed ? "oui" : "", r.error ?? ""].join(";")
      ),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "lore-import-apprenants.csv";
    a.click();
    URL.revokeObjectURL(url);
  }, [report]);

  return (
    <Panel kicker="Import en masse" title="Importer des apprenants (CSV)">
      <p className="soft" style={{ marginTop: -6, maxWidth: "62ch" }}>
        Une ligne par apprenant, colonnes <code>nom,email</code> (séparateur virgule ou point-virgule, en-tête
        facultatif). Chaque apprenant reçoit un identifiant et un mot de passe temporaire à changer à la première
        connexion.
      </p>
      <div className="col" style={{ gap: 12, maxWidth: 640 }}>
        <textarea
          rows={6}
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          placeholder={"Amara Okafor,amara@exemple.fr\nDiego Santos,diego@exemple.fr"}
          className="mono"
          style={{ fontSize: 12 }}
        />
        <div className="row" style={{ gap: 14, flexWrap: "wrap", alignItems: "center" }}>
          <input
            type="file"
            accept=".csv,text/csv,text/plain"
            onChange={(e) => void onFile(e.target.files?.[0])}
            aria-label="fichier CSV"
          />
          <label className="row" style={{ gap: 6, alignItems: "center" }}>
            <span className="quiet mono" style={{ fontSize: 11 }}>inscrire au groupe</span>
            <select value={cohortId} onChange={(e) => setCohortId(e.target.value)}>
              <option value="">— aucun —</option>
              {cohorts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="row" style={{ gap: 6, alignItems: "center" }}>
            <input type="checkbox" checked={sendEmails} onChange={(e) => setSendEmails(e.target.checked)} />
            <span className="quiet mono" style={{ fontSize: 11 }}>envoyer les invitations par e-mail</span>
          </label>
        </div>
        {error ? (
          <p className="mono" style={{ color: "var(--alarm)", fontSize: 12 }}>{error}</p>
        ) : null}
        <div className="row" style={{ gap: 10 }}>
          <button type="button" className="btn primary" disabled={busy} onClick={() => void run()}>
            {busy ? "Import en cours…" : "Importer"}
          </button>
          {report ? (
            <button type="button" className="btn ghost" onClick={downloadReport}>
              ↓ télécharger le rapport (mots de passe inclus)
            </button>
          ) : null}
        </div>
        {report ? (
          <div className="col" style={{ gap: 6 }}>
            <p className="mono" style={{ fontSize: 12 }}>
              {report.created} créé(s) · {report.existing} déjà présent(s) ·{" "}
              {report.results.filter((r) => r.status === "error").length} erreur(s)
            </p>
            <ul className="mono" style={{ fontSize: 11, margin: 0, paddingLeft: 18, maxHeight: 220, overflow: "auto" }}>
              {report.results.map((r) => (
                <li key={r.line} style={{ color: r.status === "error" ? "var(--alarm)" : undefined }}>
                  l.{r.line} {r.email || "—"} · {r.status}
                  {r.status === "created" ? ` · mdp ${r.tempPassword}${r.enrolled ? " · inscrit" : ""}${r.emailed ? " · e-mail envoyé" : ""}` : ""}
                  {r.error ? ` · ${r.error}` : ""}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </Panel>
  );
}
