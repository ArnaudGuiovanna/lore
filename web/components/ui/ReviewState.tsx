"use client";

import { useState } from "react";
import type { ReactNode } from "react";

export interface FieldDiff {
  field: string;
  before: ReactNode;
  after: ReactNode;
}

// A before-save review block: shows a field-level diff and an impact statement,
// then gates a confirm button behind a mandatory acknowledgement checkbox.
// Generic — reused by the trainer rebind flow and the admin LLM-config edit.
export function ReviewState({
  diffs,
  impact,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  acknowledgement = "I understand the impact of this change.",
  busy = false,
  error,
  onConfirm,
  onCancel,
}: {
  diffs: FieldDiff[];
  impact?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  acknowledgement?: ReactNode;
  busy?: boolean;
  error?: ReactNode;
  onConfirm: () => void;
  onCancel?: () => void;
}) {
  const [ack, setAck] = useState(false);
  const changed = diffs.filter((d) => d.before !== d.after);

  return (
    <div className="reviewstate col" style={{ gap: 18 }}>
      <div className="rs-diffs col" style={{ gap: 10 }}>
        {(changed.length ? changed : diffs).map((d) => (
          <div key={d.field} className="rs-diff">
            <span className="kicker rs-field">{d.field}</span>
            <div className="rs-change row" style={{ gap: 10, flexWrap: "wrap" }}>
              <span className="rs-before mono">{d.before}</span>
              <span className="rs-arrow quiet" aria-hidden="true">
                →
              </span>
              <span className="rs-after mono">{d.after}</span>
            </div>
          </div>
        ))}
      </div>

      {impact ? (
        <div className="rs-impact panel" style={{ padding: 16 }}>
          <span className="kicker">Impact</span>
          <div className="soft" style={{ marginTop: 6 }}>
            {impact}
          </div>
        </div>
      ) : null}

      <label className="rs-ack row" style={{ gap: 10, cursor: "pointer", alignItems: "flex-start" }}>
        <input
          type="checkbox"
          checked={ack}
          onChange={(e) => setAck(e.target.checked)}
          disabled={busy}
        />
        <span className="soft">{acknowledgement}</span>
      </label>

      {error ? (
        <p className="mono" style={{ color: "var(--alarm)", fontSize: 13, margin: 0 }}>
          {error}
        </p>
      ) : null}

      <div className="row" style={{ gap: 10 }}>
        <button
          type="button"
          className="btn primary"
          disabled={!ack || busy}
          onClick={onConfirm}
        >
          {busy ? "Saving…" : confirmLabel}
        </button>
        {onCancel ? (
          <button type="button" className="btn ghost" disabled={busy} onClick={onCancel}>
            {cancelLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}
