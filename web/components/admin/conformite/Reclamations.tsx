"use client";

// B-11 — registre des réclamations (RNQ) : liste, changement de statut
// (OPEN → IN_PROGRESS → RESOLVED/CLOSED) et résolution motivée.
import { useCallback, useEffect, useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Drawer } from "@/components/ui/Drawer";
import { ErrorState, LoadingState } from "@/components/ui/States";
import type { Complaint, ComplaintStatus } from "@/lib/types";
import type { NamedRef } from "./Conformite";

type Row = Complaint & Record<string, unknown>;

const STATUS_FR: Record<ComplaintStatus, string> = {
  OPEN: "ouverte",
  IN_PROGRESS: "en cours",
  RESOLVED: "résolue",
  CLOSED: "clôturée",
};

function fmtDate(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("fr-FR", { dateStyle: "medium" });
}

export function Reclamations({ people }: { people: NamedRef[] }) {
  const [complaints, setComplaints] = useState<Complaint[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Complaint | null>(null);
  const [edit, setEdit] = useState<{ status: ComplaintStatus; resolution: string }>({
    status: "OPEN",
    resolution: "",
  });
  const [editError, setEditError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch("/api/admin/conformite/complaints");
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setComplaints(((await res.json()) as Complaint[]) ?? []);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "chargement impossible");
      setComplaints([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = useCallback(async () => {
    if (!editing) return;
    setBusy(true);
    setEditError(null);
    try {
      const res = await fetch(
        `/api/admin/conformite/complaints/${encodeURIComponent(editing.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: edit.status, resolution: edit.resolution || undefined }),
        }
      );
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

  const nameOf = (id?: string) => (id ? people.find((p) => p.id === id)?.name ?? id.slice(0, 8) : "—");

  const columns: Column<Row>[] = [
    {
      key: "subject",
      header: "Réclamation",
      render: (r) => (
        <span className="col" style={{ gap: 2 }}>
          <span style={{ fontFamily: "var(--serif)", fontSize: 15 }}>{r.subject}</span>
          {r.description ? (
            <span className="quiet" style={{ fontSize: 12 }}>{r.description}</span>
          ) : null}
        </span>
      ),
    },
    { key: "opened_by", header: "Déposée par", render: (r) => <span>{nameOf(r.opened_by)}</span> },
    { key: "created_at", header: "Le", mono: true, render: (r) => <span>{fmtDate(r.created_at)}</span> },
    {
      key: "status",
      header: "Statut",
      render: (r) => (
        <span className={`pill ${r.status === "RESOLVED" || r.status === "CLOSED" ? "on" : ""}`} data-testid="complaint-status">
          {STATUS_FR[r.status] ?? r.status}
        </span>
      ),
    },
    {
      key: "resolution",
      header: "Résolution",
      render: (r) => <span className="quiet" style={{ fontSize: 12.5 }}>{r.resolution || "—"}</span>,
    },
    {
      key: "actions",
      header: "",
      render: (r) => (
        <button
          type="button"
          className="btn ghost"
          style={{ fontSize: 12 }}
          onClick={() => {
            setEditing(r);
            setEdit({ status: r.status, resolution: r.resolution ?? "" });
            setEditError(null);
          }}
          data-testid="complaint-edit"
        >
          traiter
        </button>
      ),
    },
  ];

  return (
    <div className="col" style={{ gap: 22 }}>
      <Panel
        kicker="Réclamations"
        title="Registre et traitement"
        aside={<span className="mono quiet" style={{ fontSize: 11 }}>OPEN → IN_PROGRESS → RESOLVED/CLOSED</span>}
      >
        {complaints === null ? (
          <LoadingState label="Chargement du registre…" />
        ) : loadError && complaints.length === 0 ? (
          <ErrorState
            kicker="Le registre n'a pas répondu"
            detail="Le registre des réclamations n'a pas pu être lu — rien n'est inventé pour combler le manque."
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
            rows={(complaints as Row[]) ?? []}
            rowKey={(r) => r.id}
            empty="Aucune réclamation au registre — c'est une bonne nouvelle, tant que le canal de dépôt est bien visible des apprenants."
          />
        )}
      </Panel>

      <Drawer
        open={!!editing}
        onClose={() => setEditing(null)}
        kicker="Traitement"
        title={editing ? editing.subject : ""}
        footer={
          <div className="row" style={{ gap: 10, justifyContent: "flex-end" }}>
            <button type="button" className="btn ghost" onClick={() => setEditing(null)}>
              Annuler
            </button>
            <button type="button" className="btn primary" disabled={busy} onClick={() => void save()} data-testid="complaint-save">
              {busy ? "…" : "Enregistrer"}
            </button>
          </div>
        }
      >
        {editing ? (
          <div className="col" style={{ gap: 12 }}>
            {editing.description ? (
              <p className="soft" style={{ fontSize: 14, margin: 0 }}>{editing.description}</p>
            ) : null}
            <label className="col" style={{ gap: 4 }}>
              <span className="quiet mono" style={{ fontSize: 11 }}>statut</span>
              <select
                value={edit.status}
                onChange={(e) => setEdit((v) => ({ ...v, status: e.target.value as ComplaintStatus }))}
                data-testid="complaint-status-select"
              >
                {(Object.keys(STATUS_FR) as ComplaintStatus[]).map((s) => (
                  <option key={s} value={s}>{STATUS_FR[s]}</option>
                ))}
              </select>
            </label>
            <label className="col" style={{ gap: 4 }}>
              <span className="quiet mono" style={{ fontSize: 11 }}>résolution (visible au registre)</span>
              <textarea
                rows={4}
                value={edit.resolution}
                onChange={(e) => setEdit((v) => ({ ...v, resolution: e.target.value }))}
                placeholder="Mesure corrective apportée…"
                data-testid="complaint-resolution"
              />
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
