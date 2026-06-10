import type { ReactNode } from "react";

// Shared state surfaces (UX-02), in the LECTURE register. Tone rules:
// - LoadingState: a quiet one-liner — never a spinner circus, never a layout shift.
// - EmptyState: a *genuine* emptiness. Say what is missing and which action fills it;
//   never fabricate data to look busy.
// - ErrorState: a backend read failed. Say so plainly ("rien n'est inventé pour
//   combler le manque") and surface the raw message for the curious.
// Tokens come from app/globals.css (.panel, .kicker, .mark, .quiet, .soft, .mono).

export function LoadingState({ label = "Chargement…" }: { label?: string }) {
  return (
    <p className="quiet mono" role="status" style={{ fontSize: 12 }}>
      {label}
    </p>
  );
}

export function EmptyState({
  kicker,
  children,
  action,
}: {
  kicker?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="panel col" style={{ gap: 10 }}>
      {kicker ? <span className="kicker">{kicker}</span> : null}
      <p className="soft" style={{ maxWidth: "58ch", fontSize: 15, lineHeight: 1.6 }}>
        {children}
      </p>
      {action ? (
        <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
          {action}
        </div>
      ) : null}
    </section>
  );
}

export function ErrorState({
  kicker,
  message,
  detail,
  mark = "erreur",
  action,
}: {
  kicker: string;
  message?: string;
  detail?: ReactNode;
  mark?: string;
  action?: ReactNode;
}) {
  return (
    <section className="panel col" role="alert" style={{ gap: 12, borderColor: "var(--line-2)" }}>
      <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <span className="mark alarm">{mark}</span>
        <span className="kicker">{kicker}</span>
      </div>
      {detail ? (
        <p className="soft" style={{ maxWidth: "58ch", fontSize: 15, lineHeight: 1.6 }}>
          {detail}
        </p>
      ) : null}
      {message ? (
        <p className="mono quiet" style={{ fontSize: 11, wordBreak: "break-word" }}>
          {message}
        </p>
      ) : null}
      {action ? (
        <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
          {action}
        </div>
      ) : null}
    </section>
  );
}
