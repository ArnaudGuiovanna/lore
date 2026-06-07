"use client";

import { useMemo, useState } from "react";
import type { Alert } from "@/lib/types";
import { Panel } from "@/components/ui/Panel";
import { alertLabel } from "@/lib/runtime";
import { fmtDate, titleCase } from "@/lib/format";
import t from "./trainer.module.css";

type Status = "OPEN" | "ACKNOWLEDGED" | "RESOLVED";

function sevClass(sev: string): string {
  const s = sev.toLowerCase();
  if (s === "critical" || s === "high") return t.alertHigh;
  if (s === "warning" || s === "medium") return t.alertMed;
  return t.alertLow;
}

// French labels for the alert lifecycle status (the pill on each row).
function statusLabel(status: string): string {
  const map: Record<string, string> = {
    OPEN: "ouverte",
    ACKNOWLEDGED: "prise en compte",
    RESOLVED: "résolue",
  };
  return map[status] ?? status.toLowerCase();
}

// ALERTS: triage runtime-raised alerts. The runtime decides WHAT to surface and the
// recommended action; the trainer only changes lifecycle status (PATCH /api/alerts/[id]).
export function Alerts({ initial, learnerName }: { initial: Alert[]; learnerName: (id: string) => string }) {
  const [alerts, setAlerts] = useState<Alert[]>(initial);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Group by recommended action (the runtime's prescription).
  const groups = useMemo(() => {
    const m = new Map<string, Alert[]>();
    for (const a of alerts) {
      const key = a.recommended_action || "review";
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(a);
    }
    return [...m.entries()];
  }, [alerts]);

  async function patch(id: string, status: Status) {
    setPending(id);
    setError(null);
    try {
      const res = await fetch(`/api/alerts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? `HTTP ${res.status}`);
        return;
      }
      setAlerts((as) => as.map((a) => (a.id === id ? (data as Alert) : a)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "erreur réseau");
    } finally {
      setPending(null);
    }
  }

  const open = alerts.filter((a) => a.status !== "RESOLVED").length;

  return (
    <Panel
      kicker="Alertes · groupées par action recommandée"
      title="Triez les signaux du runtime"
      aside={<span className="mono quiet" style={{ fontSize: 12 }}>{open} ouverte(s) · {alerts.length} au total</span>}
    >
      <p className="soft" style={{ marginTop: -6, marginBottom: 20, maxWidth: "62ch" }}>
        Le runtime les remonte depuis l&apos;état durable et prescrit une action. Vous fixez le statut du cycle de
        vie — vous ne modifiez jamais la maîtrise.
      </p>

      {error ? (
        <p className="mono" style={{ color: "var(--alarm)", fontSize: 13, marginBottom: 14 }}>{error}</p>
      ) : null}

      {alerts.length === 0 ? (
        <p className="quiet mono" style={{ fontSize: 13 }}>Aucune alerte. Le groupe est dans les clous.</p>
      ) : (
        groups.map(([action, items]) => (
          <div key={action} style={{ marginBottom: 22 }}>
            <div className="row" style={{ gap: 10, marginBottom: 10 }}>
              <span className="kicker" style={{ color: "var(--accent)" }}>{titleCase(action)}</span>
              <span className="pill">{items.length}</span>
            </div>
            {items.map((a) => {
              const resolved = a.status === "RESOLVED";
              return (
                <div
                  key={a.id}
                  className={`${t.alertRow} ${sevClass(a.severity)} ${resolved ? t.alertResolved : ""}`}
                >
                  <div className={t.alertSev}>
                    <span className="kicker" style={{ letterSpacing: "0.06em" }}>{a.severity}</span>
                    <span className="quiet mono" style={{ fontSize: 9.5 }}>{a.alert_type}</span>
                  </div>
                  <div className={t.alertBody}>
                    <strong className="row" style={{ gap: 9, fontFamily: "var(--serif)", fontSize: 16 }}>
                      {learnerName(a.learner_id)}
                      <span className="pill">{statusLabel(a.status)}</span>
                    </strong>
                    <span className="soft" style={{ fontSize: 14 }}>
                      {alertLabel(a.alert_type)}
                      {a.concept_id ? <> · <span className="mono">{a.concept_id}</span></> : null} — {a.recommended_action}
                    </span>
                    <span className="quiet mono" style={{ fontSize: 10 }}>
                      émise le {fmtDate(a.created_at, true)}
                    </span>
                  </div>
                  <div className={t.alertActions}>
                    {a.status === "OPEN" ? (
                      <button
                        type="button"
                        className="btn"
                        disabled={pending === a.id}
                        onClick={() => patch(a.id, "ACKNOWLEDGED")}
                      >
                        {pending === a.id ? "…" : "Prendre en compte"}
                      </button>
                    ) : null}
                    {a.status !== "RESOLVED" ? (
                      <button
                        type="button"
                        className="btn primary"
                        disabled={pending === a.id}
                        onClick={() => patch(a.id, "RESOLVED")}
                      >
                        {pending === a.id ? "…" : "Résoudre"}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn ghost"
                        disabled={pending === a.id}
                        onClick={() => patch(a.id, "OPEN")}
                      >
                        Rouvrir
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))
      )}
    </Panel>
  );
}
