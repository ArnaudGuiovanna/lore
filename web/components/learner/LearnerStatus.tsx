import type { ReactNode } from "react";
import Link from "next/link";

// Honest, on-brand status panels for the learner surface. The runtime owns the
// truth; when we cannot reach it we say so plainly rather than fabricating an
// empty state. Tone "alarm" = the backend did not answer; tone "quiet" = a
// genuine, healthy emptiness.
export function LearnerError({
  kicker = "Le runtime n'a pas répondu",
  detail,
  message,
}: {
  kicker?: string;
  detail?: ReactNode;
  message?: string;
}) {
  return (
    <section
      className="panel col"
      role="alert"
      style={{ gap: 12, borderColor: "var(--line-2)" }}
    >
      <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <span className="mark alarm">hors ligne</span>
        <span className="kicker">{kicker}</span>
      </div>
      <p className="soft" style={{ maxWidth: "58ch", fontSize: 15, lineHeight: 1.6 }}>
        {detail ??
          "Nous n'avons pas pu joindre le runtime d'apprentissage ; nous ne devinerons donc pas votre état. Votre progression est en sécurité sur le backend — ceci n'est qu'une lecture."}
      </p>
      {message ? (
        <p className="mono quiet" style={{ fontSize: 11, wordBreak: "break-word" }}>
          {message}
        </p>
      ) : null}
      <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
        <Link href="/learner" className="btn">
          ↺ réessayer
        </Link>
      </div>
    </section>
  );
}

export function LearnerEmpty({
  kicker,
  children,
}: {
  kicker?: string;
  children: ReactNode;
}) {
  return (
    <section className="panel col" style={{ gap: 10 }}>
      {kicker ? <span className="kicker">{kicker}</span> : null}
      <p className="soft" style={{ maxWidth: "58ch", fontSize: 15, lineHeight: 1.6 }}>
        {children}
      </p>
    </section>
  );
}
