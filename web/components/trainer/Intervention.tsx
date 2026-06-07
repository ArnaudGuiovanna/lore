"use client";

import { useMemo, useState } from "react";
import type { Alert } from "@/lib/types";
import { Panel } from "@/components/ui/Panel";
import { Card } from "@/components/ui/Card";
import { SourceMark } from "@/components/runtime/SourceMark";
import { alertLabel } from "@/lib/runtime";
import { classNames, fmtPct } from "@/lib/format";
import type { LearnerRow } from "./types";
import t from "./trainer.module.css";

type ActionId = "retrieval" | "nudge" | "repair" | "escalate";

interface ActionDef {
  id: ActionId;
  title: string;
  desc: string;
  effect: string;
  // Maps to the one sanctioned lifecycle change the backend actually owns.
  lifecycle?: "ACKNOWLEDGED" | "RESOLVED";
}

// INTERVENTION: the trainer never hand-edits mastery or review state — the runtime owns
// pedagogical truth. The trainer REQUESTS a sanctioned action; the runtime applies it and
// re-derives state. "Assign a repair activity" is gated on an ACTIVE misconception — if the
// runtime tracks none, the block is decay, not error, and repair is unavailable.
export function Intervention({ learners }: { learners: LearnerRow[] }) {
  // Default to the learner the runtime is most worried about.
  const ranked = useMemo(
    () =>
      [...learners].sort(
        (a, b) => b.openAlerts - a.openAlerts || (a.avgMastery ?? 1) - (b.avgMastery ?? 1)
      ),
    [learners]
  );
  const [selectedId, setSelectedId] = useState<string>(ranked[0]?.id ?? learners[0]?.id);
  const learner = learners.find((l) => l.id === selectedId) ?? learners[0];

  const primaryAlert: Alert | undefined = learner?.alerts[0];
  const concept = primaryAlert?.concept_id ?? "the overdue concept";

  const actions: ActionDef[] = useMemo(
    () => [
      {
        id: "retrieval",
        title: "Schedule a retrieval session",
        desc: `Queue a spaced-retrieval session on ${concept} — targets the overdue reviews driving retention down.`,
        effect: "runtime effect · FSRS re-anchors the review schedule; no mastery change until the learner engages.",
        lifecycle: "ACKNOWLEDGED",
      },
      {
        id: "nudge",
        title: "Send a re-engagement nudge",
        desc: "A calm, runtime-templated message inviting the learner back — addresses absence first.",
        effect: "runtime effect · queues a notification; no state change. Often paired with retrieval.",
        lifecycle: "ACKNOWLEDGED",
      },
      {
        id: "repair",
        title: "Assign a repair activity",
        desc: "Targets an active misconception. The runtime makes this available only when it tracks one.",
        effect: "runtime effect · queues a repair activity bound to the misconception.",
      },
      {
        id: "escalate",
        title: "Escalate to program advisor",
        desc: "Hand off to a human advisor if engagement does not recover — keeps a person in the loop beyond the runtime.",
        effect: "runtime effect · routes the alert; leaves it open under advisor ownership.",
        lifecycle: "RESOLVED",
      },
    ],
    [concept]
  );

  const repairEnabled = !!learner?.hasMisconception;
  const [action, setAction] = useState<ActionId>("retrieval");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState<{ action: ActionId; status: string } | null>(null);

  function isDisabled(a: ActionDef) {
    return a.id === "repair" && !repairEnabled;
  }

  function selectAction(a: ActionDef) {
    if (isDisabled(a)) return;
    setAction(a.id);
    setApplied(null);
    setError(null);
  }

  const chosen = actions.find((a) => a.id === action)!;

  async function apply() {
    if (busy || !learner) return;
    // The only act the runtime actually accepts here is an alert lifecycle change —
    // a sanctioned move. We never write mastery or review state by hand.
    if (!chosen.lifecycle || !primaryAlert) {
      setApplied({ action: chosen.id, status: "requested" });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/alerts/${primaryAlert.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: chosen.lifecycle }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? `HTTP ${res.status}`);
        return;
      }
      setApplied({ action: chosen.id, status: chosen.lifecycle.toLowerCase() });
    } catch (e) {
      setError(e instanceof Error ? e.message : "network error");
    } finally {
      setBusy(false);
    }
  }

  if (!learner) {
    return (
      <Panel kicker="Intervention" title="No learners">
        <p className="quiet mono" style={{ fontSize: 13 }}>No learners in this cohort.</p>
      </Panel>
    );
  }

  return (
    <div className="col" style={{ gap: 20 }}>
      <Panel kicker="Intervention · learner" title="Pick whom to intervene for">
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          {ranked.map((l) => (
            <button
              key={l.id}
              type="button"
              className="btn"
              style={{
                borderColor: l.id === selectedId ? "var(--accent)" : "var(--line-2)",
                color: l.id === selectedId ? "var(--accent)" : undefined,
                background: l.id === selectedId ? "var(--accent-soft)" : undefined,
              }}
              onClick={() => {
                setSelectedId(l.id);
                setApplied(null);
                setError(null);
                setAction("retrieval");
              }}
            >
              {l.name}
              {l.openAlerts > 0 ? <span className="pill" style={{ marginLeft: 6 }}>{l.openAlerts}</span> : null}
            </button>
          ))}
        </div>
      </Panel>

      <Panel
        kicker={`Intervention · ${learner.name}`}
        title="Choose a sanctioned action"
        aside={<SourceMark source="runtime" label="human-in-the-loop" />}
      >
        <p className="soft" style={{ marginTop: -6, marginBottom: 16, maxWidth: "62ch" }}>
          You do not hand-edit mastery or review state — the runtime owns pedagogical truth. You request a
          sanctioned move; the runtime applies it and re-derives state from the result.
        </p>

        <Card
          style={{
            background: "var(--accent-soft)",
            borderColor: "rgba(42,79,62,.3)",
            marginBottom: 18,
            display: "flex",
            gap: 12,
            alignItems: "flex-start",
          }}
        >
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="var(--accent)"
            strokeWidth={2}
            aria-hidden="true"
            style={{ flex: "0 0 auto", marginTop: 2 }}
          >
            <path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z" />
            <path d="M9 12l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <p className="soft" style={{ margin: 0, fontSize: 14, color: "var(--ink-soft)" }}>
            The console is never the source of pedagogical truth. Mastery (<b>BKT</b>) and review state
            (<b>FSRS</b>) are read-only here — current avg mastery <span className="mono">{fmtPct(learner.avgMastery)}</span>,
            retention <span className="mono">{fmtPct(learner.avgRetention)}</span>. The runtime decides what it does to
            state and writes an audit snapshot.
          </p>
        </Card>

        {primaryAlert ? (
          <p className="quiet mono" style={{ fontSize: 11, marginTop: -4, marginBottom: 14 }}>
            runtime signal · {alertLabel(primaryAlert.alert_type)}
            {primaryAlert.concept_id ? ` · ${primaryAlert.concept_id}` : ""} · recommends &ldquo;{primaryAlert.recommended_action}&rdquo;
          </p>
        ) : (
          <p className="quiet mono" style={{ fontSize: 11, marginTop: -4, marginBottom: 14 }}>
            No open runtime alert for {learner.name} — any action here is advisory only.
          </p>
        )}

        <div className={t.intervGrid} role="radiogroup" aria-label="Sanctioned interventions">
          {actions.map((a) => {
            const disabled = isDisabled(a);
            const selected = a.id === action && !disabled;
            return (
              <button
                key={a.id}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-disabled={disabled}
                disabled={disabled}
                className={classNames(t.actionCard, selected && t.actionOn, disabled && t.actionOff)}
                onClick={() => selectAction(a)}
              >
                <span className={t.actionTitle}>
                  {a.title}
                  {a.id === "retrieval" ? <span className="pill on" style={{ marginLeft: 8 }}>recommended</span> : null}
                </span>
                <span className={t.actionDesc}>{a.desc}</span>
                <span className={t.actionEffect}>
                  {disabled
                    ? "unavailable · no active misconception to repair — this block is decay, not error"
                    : a.effect}
                </span>
              </button>
            );
          })}
        </div>

        {error ? (
          <p className="mono" style={{ color: "var(--alarm)", fontSize: 13, marginTop: 16 }}>{error}</p>
        ) : null}

        <div className={t.confirmBar}>
          <p className="soft" style={{ margin: 0, fontSize: 14, maxWidth: "62ch" }}>
            {applied ? (
              <>
                Requested <strong>{chosen.title.toLowerCase()}</strong> for {learner.name}. The runtime took
                ownership — alert now <span className="mono">{applied.status}</span>; it will close itself when the
                learner completes the work. You changed nothing by hand.
              </>
            ) : (
              <>
                You will request <strong>{chosen.title.toLowerCase()}</strong> for {learner.name}. The runtime
                applies it and writes an audit snapshot — you change nothing by hand.
              </>
            )}
          </p>
          <button type="button" className="btn primary" disabled={busy || !!applied} onClick={apply}>
            {busy ? "Applying…" : applied ? "Applied ✓" : "Apply intervention"}
          </button>
        </div>
      </Panel>
    </div>
  );
}
