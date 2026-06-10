"use client";

// B-15 — dossiers de financement (CPF, OPCO, France Travail, employeur…) +
// encart BPF annuel. Les montants sont SAISIS en euros et STOCKÉS en cents ;
// la conversion se fait ici, jamais dans le backend.
import { useCallback, useEffect, useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Drawer } from "@/components/ui/Drawer";
import { Metric } from "@/components/ui/Metric";
import { ErrorState, LoadingState } from "@/components/ui/States";
import type { BPFReport, FunderType, FundingFile, FundingStatus } from "@/lib/types";
import type { NamedRef } from "./Conformite";

type Row = FundingFile & Record<string, unknown>;

const FUNDER_FR: Record<FunderType, string> = {
  CPF: "CPF",
  OPCO: "OPCO",
  FRANCE_TRAVAIL: "France Travail",
  EMPLOYEUR: "Employeur",
  AUTOFINANCEMENT: "Autofinancement",
  AUTRE: "Autre",
};

const STATUS_FR: Record<FundingStatus, string> = {
  EN_INSTRUCTION: "en instruction",
  ACCEPTE: "accepté",
  REFUSE: "refusé",
  SOLDE: "soldé",
};

function euros(cents: number): string {
  return (cents / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
}

// "1 500,50" / "1500.50" → 150050 cents (NaN si illisible).
function parseEurosToCents(raw: string): number {
  const cleaned = raw.replace(/\s/g, "").replace(",", ".");
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return Number.NaN;
  return Math.round(value * 100);
}

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

export function Financements({ cohorts, learners }: { cohorts: NamedRef[]; learners: NamedRef[] }) {
  const [files, setFiles] = useState<FundingFile[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [form, setForm] = useState({
    learnerId: learners[0]?.id ?? "",
    cohortId: cohorts[0]?.id ?? "",
    funderType: "CPF" as FunderType,
    funderName: "",
    reference: "",
    status: "EN_INSTRUCTION" as FundingStatus,
    amountEuros: "",
    notes: "",
  });

  // Édition d'un dossier existant (statut / montant / référence).
  const [editing, setEditing] = useState<FundingFile | null>(null);
  const [edit, setEdit] = useState({ status: "EN_INSTRUCTION" as FundingStatus, amountEuros: "", reference: "" });
  const [editError, setEditError] = useState<string | null>(null);

  // Encart BPF.
  const currentYear = new Date().getFullYear();
  const [bpfYear, setBpfYear] = useState(String(currentYear));
  const [bpf, setBpf] = useState<BPFReport | null>(null);
  const [bpfError, setBpfError] = useState<string | null>(null);
  const [bpfBusy, setBpfBusy] = useState(false);

  const refresh = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch("/api/admin/conformite/funding");
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setFiles(((await res.json()) as FundingFile[]) ?? []);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "chargement impossible");
      setFiles([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const cents = parseEurosToCents(form.amountEuros);
      if (!form.learnerId || Number.isNaN(cents) || cents < 0) {
        setError("apprenant et montant (en euros) sont requis");
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const res = await fetch("/api/admin/conformite/funding", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            learner_id: form.learnerId,
            cohort_id: form.cohortId || undefined,
            funder_type: form.funderType,
            funder_name: form.funderName || undefined,
            reference: form.reference || undefined,
            status: form.status,
            amount_cents: cents,
            notes: form.notes || undefined,
          }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        setForm((f) => ({ ...f, funderName: "", reference: "", amountEuros: "", notes: "" }));
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "création impossible");
      } finally {
        setBusy(false);
      }
    },
    [form, refresh]
  );

  const saveEdit = useCallback(async () => {
    if (!editing) return;
    const cents = parseEurosToCents(edit.amountEuros);
    if (Number.isNaN(cents) || cents < 0) {
      setEditError("montant en euros illisible");
      return;
    }
    setBusy(true);
    setEditError(null);
    try {
      const res = await fetch(`/api/admin/conformite/funding/${encodeURIComponent(editing.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: edit.status,
          amount_cents: cents,
          reference: edit.reference || undefined,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setEditing(null);
      await refresh();
    } catch (e) {
      setEditError(e instanceof Error ? e.message : "mise à jour impossible");
    } finally {
      setBusy(false);
    }
  }, [editing, edit, refresh]);

  const archive = useCallback(
    async (id: string) => {
      setBusy(true);
      try {
        await fetch(`/api/admin/conformite/funding/${encodeURIComponent(id)}`, { method: "DELETE" });
        await refresh();
      } finally {
        setBusy(false);
      }
    },
    [refresh]
  );

  const loadBpf = useCallback(async () => {
    if (!/^\d{4}$/.test(bpfYear)) {
      setBpfError("année au format YYYY");
      return;
    }
    setBpfBusy(true);
    setBpfError(null);
    try {
      const res = await fetch(`/api/admin/conformite/bpf?year=${bpfYear}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setBpf((await res.json()) as BPFReport);
    } catch (e) {
      setBpfError(e instanceof Error ? e.message : "lecture impossible");
      setBpf(null);
    } finally {
      setBpfBusy(false);
    }
  }, [bpfYear]);

  const learnerName = (id: string) => learners.find((l) => l.id === id)?.name ?? id.slice(0, 8);

  const columns: Column<Row>[] = [
    { key: "learner_id", header: "Apprenant", render: (r) => <span>{learnerName(r.learner_id)}</span> },
    {
      key: "funder_type",
      header: "Financeur",
      render: (r) => (
        <span className="col" style={{ gap: 2 }}>
          <span>{FUNDER_FR[r.funder_type] ?? r.funder_type}</span>
          {r.funder_name ? <span className="quiet" style={{ fontSize: 11.5 }}>{r.funder_name}</span> : null}
        </span>
      ),
    },
    { key: "reference", header: "Référence", mono: true, render: (r) => <span>{r.reference || "—"}</span> },
    {
      key: "status",
      header: "Statut",
      render: (r) => (
        <span className={`pill ${r.status === "ACCEPTE" || r.status === "SOLDE" ? "on" : ""}`}>
          {STATUS_FR[r.status] ?? r.status}
        </span>
      ),
    },
    {
      key: "amount_cents",
      header: "Montant",
      align: "right",
      mono: true,
      render: (r) => <span data-testid="funding-amount">{euros(r.amount_cents)}</span>,
    },
    {
      key: "actions",
      header: "",
      render: (r) => (
        <span className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
          <button
            type="button"
            className="btn ghost"
            style={{ fontSize: 12 }}
            onClick={() => {
              setEditing(r);
              setEdit({
                status: r.status,
                amountEuros: (r.amount_cents / 100).toString().replace(".", ","),
                reference: r.reference ?? "",
              });
              setEditError(null);
            }}
          >
            éditer
          </button>
          <button
            type="button"
            className="btn ghost"
            style={{ fontSize: 12, color: "var(--alarm)" }}
            disabled={busy}
            onClick={() => void archive(r.id)}
          >
            archiver
          </button>
        </span>
      ),
    },
  ];

  return (
    <div className="col" style={{ gap: 22 }}>
      <Panel
        kicker="Financements"
        title="Dossiers de financement"
        aside={<span className="mono quiet" style={{ fontSize: 11 }}>source administrative du BPF</span>}
      >
        {files === null ? (
          <LoadingState label="Chargement des dossiers…" />
        ) : loadError && files.length === 0 ? (
          <ErrorState
            kicker="Les dossiers n'ont pas répondu"
            detail="Les dossiers de financement n'ont pas pu être lus — rien n'est inventé pour combler le manque."
            message={loadError}
            action={
              <button type="button" className="btn" onClick={() => void refresh()}>
                ↺ réessayer
              </button>
            }
          />
        ) : (
          <DataTable<Row>
            columns={columns}
            rows={(files as Row[]) ?? []}
            rowKey={(r) => r.id}
            empty="Aucun dossier — créez le premier ci-dessous."
          />
        )}
      </Panel>

      <Panel kicker="Nouveau dossier" title="Enregistrer un financement">
        <form onSubmit={create} className="col" style={{ gap: 12, maxWidth: 680 }} data-testid="funding-create-form">
          <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
            <label className="col" style={{ gap: 4 }}>
              <span className="quiet mono" style={{ fontSize: 11 }}>apprenant</span>
              <select
                value={form.learnerId}
                onChange={(e) => setForm((f) => ({ ...f, learnerId: e.target.value }))}
                data-testid="funding-learner"
              >
                {learners.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
            </label>
            <label className="col" style={{ gap: 4 }}>
              <span className="quiet mono" style={{ fontSize: 11 }}>cohorte</span>
              <select value={form.cohortId} onChange={(e) => setForm((f) => ({ ...f, cohortId: e.target.value }))}>
                <option value="">—</option>
                {cohorts.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
            <label className="col" style={{ gap: 4 }}>
              <span className="quiet mono" style={{ fontSize: 11 }}>financeur</span>
              <select
                value={form.funderType}
                onChange={(e) => setForm((f) => ({ ...f, funderType: e.target.value as FunderType }))}
                data-testid="funding-funder-type"
              >
                {(Object.keys(FUNDER_FR) as FunderType[]).map((t) => (
                  <option key={t} value={t}>{FUNDER_FR[t]}</option>
                ))}
              </select>
            </label>
            <label className="col" style={{ gap: 4 }}>
              <span className="quiet mono" style={{ fontSize: 11 }}>statut</span>
              <select
                value={form.status}
                onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as FundingStatus }))}
              >
                {(Object.keys(STATUS_FR) as FundingStatus[]).map((s) => (
                  <option key={s} value={s}>{STATUS_FR[s]}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
            <label className="col" style={{ gap: 4, flex: 1, minWidth: 180 }}>
              <span className="quiet mono" style={{ fontSize: 11 }}>nom du financeur (optionnel)</span>
              <input
                value={form.funderName}
                onChange={(e) => setForm((f) => ({ ...f, funderName: e.target.value }))}
                placeholder="Caisse des Dépôts, Atlas…"
              />
            </label>
            <label className="col" style={{ gap: 4, flex: 1, minWidth: 160 }}>
              <span className="quiet mono" style={{ fontSize: 11 }}>référence (n° EDOF/OPCO…)</span>
              <input
                value={form.reference}
                onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))}
                placeholder="EDOF-2026-001"
                data-testid="funding-reference"
              />
            </label>
            <label className="col" style={{ gap: 4 }}>
              <span className="quiet mono" style={{ fontSize: 11 }}>montant (€)</span>
              <input
                value={form.amountEuros}
                onChange={(e) => setForm((f) => ({ ...f, amountEuros: e.target.value }))}
                placeholder="1500"
                style={{ width: 120 }}
                data-testid="funding-amount-input"
              />
            </label>
          </div>
          <label className="col" style={{ gap: 4 }}>
            <span className="quiet mono" style={{ fontSize: 11 }}>notes (optionnel)</span>
            <input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
          </label>
          {error ? (
            <p className="mono" style={{ color: "var(--alarm)", fontSize: 12, margin: 0 }}>{error}</p>
          ) : null}
          <div>
            <button
              type="submit"
              className="btn primary"
              disabled={busy || learners.length === 0}
              data-testid="funding-create-submit"
            >
              {busy ? "…" : "Enregistrer le dossier"}
            </button>
          </div>
        </form>
      </Panel>

      <Panel
        kicker="BPF"
        title="Bilan pédagogique et financier"
        aside={<span className="mono quiet" style={{ fontSize: 11 }}>GET /bpf-export?year=</span>}
      >
        <div className="col" style={{ gap: 14 }}>
          <div className="row" style={{ gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
            <label className="col" style={{ gap: 4 }}>
              <span className="quiet mono" style={{ fontSize: 11 }}>année</span>
              <input
                value={bpfYear}
                onChange={(e) => setBpfYear(e.target.value)}
                style={{ width: 100 }}
                data-testid="bpf-year"
              />
            </label>
            <button type="button" className="btn" disabled={bpfBusy} onClick={() => void loadBpf()} data-testid="bpf-load">
              {bpfBusy ? "…" : "Lire le rapport"}
            </button>
            {bpf ? (
              <button
                type="button"
                className="btn ghost"
                onClick={() => downloadJSON(`bpf-${bpf.year}.json`, bpf)}
                data-testid="bpf-download"
              >
                ↓ télécharger le JSON
              </button>
            ) : null}
          </div>
          {bpfError ? (
            <p className="mono" style={{ color: "var(--alarm)", fontSize: 12, margin: 0 }}>{bpfError}</p>
          ) : null}
          {bpf ? (
            <div className="col" style={{ gap: 14 }} data-testid="bpf-report">
              <div className="row" style={{ gap: 28, flexWrap: "wrap" }}>
                <Metric label="stagiaires" value={bpf.total_learners} hint={`année ${bpf.year}`} />
                <Metric
                  label="heures formées"
                  value={bpf.total_trained_hours.toLocaleString("fr-FR", { maximumFractionDigits: 1 })}
                  hint="pauses exclues (FOAD)"
                />
                <Metric label="produits" value={euros(bpf.total_amount_cents)} hint="toutes origines" tone="accent" />
              </div>
              <DataTable<BPFFunderRow>
                columns={[
                  {
                    key: "funder_type",
                    header: "Origine des produits",
                    render: (r) => <span>{FUNDER_FR[r.funder_type as FunderType] ?? r.funder_type}</span>,
                  },
                  { key: "files", header: "Dossiers", align: "right", mono: true },
                  { key: "learners", header: "Stagiaires", align: "right", mono: true },
                  {
                    key: "amount_cents",
                    header: "Montant",
                    align: "right",
                    mono: true,
                    render: (r) => <span>{euros(r.amount_cents)}</span>,
                  },
                ]}
                rows={(bpf.by_funder ?? []) as BPFFunderRow[]}
                rowKey={(r) => r.funder_type}
                empty="Aucun produit sur l'année — le BPF de cette année est vide."
              />
            </div>
          ) : null}
        </div>
      </Panel>

      <Drawer
        open={!!editing}
        onClose={() => setEditing(null)}
        kicker="Dossier de financement"
        title={editing ? `${learnerName(editing.learner_id)} · ${FUNDER_FR[editing.funder_type] ?? editing.funder_type}` : ""}
        footer={
          <div className="row" style={{ gap: 10, justifyContent: "flex-end" }}>
            <button type="button" className="btn ghost" onClick={() => setEditing(null)}>
              Annuler
            </button>
            <button type="button" className="btn primary" disabled={busy} onClick={() => void saveEdit()}>
              {busy ? "…" : "Enregistrer"}
            </button>
          </div>
        }
      >
        {editing ? (
          <div className="col" style={{ gap: 12 }}>
            <label className="col" style={{ gap: 4 }}>
              <span className="quiet mono" style={{ fontSize: 11 }}>statut</span>
              <select
                value={edit.status}
                onChange={(e) => setEdit((v) => ({ ...v, status: e.target.value as FundingStatus }))}
              >
                {(Object.keys(STATUS_FR) as FundingStatus[]).map((s) => (
                  <option key={s} value={s}>{STATUS_FR[s]}</option>
                ))}
              </select>
            </label>
            <label className="col" style={{ gap: 4 }}>
              <span className="quiet mono" style={{ fontSize: 11 }}>montant (€)</span>
              <input
                value={edit.amountEuros}
                onChange={(e) => setEdit((v) => ({ ...v, amountEuros: e.target.value }))}
              />
            </label>
            <label className="col" style={{ gap: 4 }}>
              <span className="quiet mono" style={{ fontSize: 11 }}>référence</span>
              <input value={edit.reference} onChange={(e) => setEdit((v) => ({ ...v, reference: e.target.value }))} />
            </label>
            {editError ? (
              <p className="mono" style={{ color: "var(--alarm)", fontSize: 12, margin: 0 }}>{editError}</p>
            ) : null}
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}

type BPFFunderRow = { funder_type: string; files: number; learners: number; amount_cents: number } & Record<string, unknown>;
