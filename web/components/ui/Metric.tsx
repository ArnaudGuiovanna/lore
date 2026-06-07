import type { ReactNode } from "react";

type Tone = "ink" | "accent" | "alarm" | "amber";
const TONE: Record<Tone, string> = {
  ink: "var(--ink)",
  accent: "var(--accent)",
  alarm: "var(--alarm)",
  amber: "var(--amber)",
};

// A single labelled metric in LECTURE mono. Evidence over vanity — keep labels honest.
export function Metric({
  label,
  value,
  hint,
  tone = "ink",
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
}) {
  return (
    <div className="metric col" style={{ gap: 3 }}>
      <span className="k">{label}</span>
      <span className="v" style={{ color: TONE[tone] }}>
        {value}
      </span>
      {hint ? (
        <span className="quiet" style={{ fontSize: 11, fontFamily: "var(--mono)" }}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}
