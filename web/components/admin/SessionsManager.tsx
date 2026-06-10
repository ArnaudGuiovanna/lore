"use client";

import { useCallback, useEffect, useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { DataTable, type Column } from "@/components/ui/DataTable";
import type { TrainingSession } from "@/lib/types";
import type { ManagedProgram } from "./types";

type Row = TrainingSession & Record<string, unknown>;

function fmtDate(value: string): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" });
}

// Planned sessions manager (B-12): list, create, archive. Sessions are the
// scheduling backbone for émargement, calendar and FOAD evidence.
export function SessionsManager({ programs }: { programs: ManagedProgram[] }) {
  const cohorts = programs.flatMap((p) => p.cohorts.map((c) => ({ ...c, programName: p.name })));
  const [sessions, setSessions] = useState<TrainingSession[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    cohortId: cohorts[0]?.id ?? "",
    title: "",
    date: "",
    start: "09:00",
    end: "12:30",
    capacity: 12,
    location: "",
    videoUrl: "",
  });

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/admin/sessions");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSessions(((await res.json()) as TrainingSession[]) ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "chargement impossible");
      setSessions([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!form.cohortId || !form.title || !form.date) {
        setError("groupe, titre et date sont requis");
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const res = await fetch("/api/admin/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cohort_id: form.cohortId,
            title: form.title,
            starts_at: new Date(`${form.date}T${form.start}:00`).toISOString(),
            ends_at: new Date(`${form.date}T${form.end}:00`).toISOString(),
            capacity: Number(form.capacity) || 0,
            location: form.location || undefined,
            video_url: form.videoUrl || undefined,
          }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        setForm((f) => ({ ...f, title: "", location: "", videoUrl: "" }));
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "création impossible");
      } finally {
        setBusy(false);
      }
    },
    [form, refresh]
  );

  const archive = useCallback(
    async (id: string) => {
      setBusy(true);
      try {
        await fetch(`/api/admin/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
        await refresh();
      } finally {
        setBusy(false);
      }
    },
    [refresh]
  );

  const cohortName = (id: string) => cohorts.find((c) => c.id === id)?.name ?? id.slice(0, 8);

  const columns: Column<Row>[] = [
    { key: "title", header: "Session" },
    { key: "cohort_id", header: "Groupe", render: (r) => <span>{cohortName(r.cohort_id)}</span> },
    { key: "starts_at", header: "Début", mono: true, render: (r) => <span>{fmtDate(r.starts_at)}</span> },
    { key: "ends_at", header: "Fin", mono: true, render: (r) => <span>{fmtDate(r.ends_at)}</span> },
    {
      key: "mode",
      header: "Modalité",
      render: (r) =>
        r.video_url ? (
          <a className="mono" style={{ fontSize: 12, color: "var(--accent)" }} href={r.video_url} target="_blank" rel="noreferrer">
            visio ↗
          </a>
        ) : (
          <span>{r.location || "présentiel"}</span>
        ),
    },
    { key: "capacity", header: "Capacité", align: "right", mono: true },
    { key: "status", header: "Statut", render: (r) => <span className="pill">{r.status.toLowerCase()}</span> },
    {
      key: "actions",
      header: "",
      render: (r) =>
        r.status !== "ARCHIVED" ? (
          <button type="button" className="btn ghost" style={{ fontSize: 12 }} disabled={busy} onClick={() => void archive(r.id)}>
            archiver
          </button>
        ) : null,
    },
  ];

  return (
    <div className="col" style={{ gap: 22 }}>
      <Panel kicker="Planification" title="Sessions planifiées">
        {sessions === null ? (
          <p className="quiet mono" style={{ fontSize: 12 }}>Chargement des sessions…</p>
        ) : (
          <DataTable<Row>
            columns={columns}
            rows={(sessions as Row[]) ?? []}
            rowKey={(r) => r.id}
            empty="Aucune session planifiée — créez la première ci-dessous."
          />
        )}
      </Panel>

      <Panel kicker="Nouvelle session" title="Planifier une séance">
        <form onSubmit={create} className="col" style={{ gap: 12, maxWidth: 560 }}>
          <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
            <label className="col" style={{ gap: 4 }}>
              <span className="quiet mono" style={{ fontSize: 11 }}>groupe</span>
              <select value={form.cohortId} onChange={(e) => setForm((f) => ({ ...f, cohortId: e.target.value }))}>
                {cohorts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="col" style={{ gap: 4, flex: 1, minWidth: 200 }}>
              <span className="quiet mono" style={{ fontSize: 11 }}>titre</span>
              <input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="Atelier transactions" />
            </label>
          </div>
          <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
            <label className="col" style={{ gap: 4 }}>
              <span className="quiet mono" style={{ fontSize: 11 }}>date</span>
              <input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
            </label>
            <label className="col" style={{ gap: 4 }}>
              <span className="quiet mono" style={{ fontSize: 11 }}>début</span>
              <input type="time" value={form.start} onChange={(e) => setForm((f) => ({ ...f, start: e.target.value }))} />
            </label>
            <label className="col" style={{ gap: 4 }}>
              <span className="quiet mono" style={{ fontSize: 11 }}>fin</span>
              <input type="time" value={form.end} onChange={(e) => setForm((f) => ({ ...f, end: e.target.value }))} />
            </label>
            <label className="col" style={{ gap: 4 }}>
              <span className="quiet mono" style={{ fontSize: 11 }}>capacité</span>
              <input
                type="number"
                min={0}
                value={form.capacity}
                onChange={(e) => setForm((f) => ({ ...f, capacity: Number(e.target.value) }))}
                style={{ width: 90 }}
              />
            </label>
          </div>
          <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
            <label className="col" style={{ gap: 4, flex: 1, minWidth: 180 }}>
              <span className="quiet mono" style={{ fontSize: 11 }}>lieu (présentiel)</span>
              <input value={form.location} onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} placeholder="Salle B204" />
            </label>
            <label className="col" style={{ gap: 4, flex: 1, minWidth: 180 }}>
              <span className="quiet mono" style={{ fontSize: 11 }}>lien visio (distanciel)</span>
              <input value={form.videoUrl} onChange={(e) => setForm((f) => ({ ...f, videoUrl: e.target.value }))} placeholder="https://…" />
            </label>
          </div>
          {error ? (
            <p className="mono" style={{ color: "var(--alarm)", fontSize: 12 }}>{error}</p>
          ) : null}
          <div>
            <button type="submit" className="btn primary" disabled={busy || cohorts.length === 0}>
              {busy ? "…" : "Planifier la session"}
            </button>
          </div>
        </form>
      </Panel>
    </div>
  );
}
