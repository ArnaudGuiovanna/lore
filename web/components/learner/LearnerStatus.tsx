import type { ReactNode } from "react";
import Link from "next/link";

// Honest, on-brand status panels for the learner surface. The runtime owns the
// truth; when we cannot reach it we say so plainly rather than fabricating an
// empty state. Tone "alarm" = the backend did not answer; tone "quiet" = a
// genuine, healthy emptiness.
export function LearnerError({
  kicker = "The runtime didn't answer",
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
        <span className="mark alarm">offline</span>
        <span className="kicker">{kicker}</span>
      </div>
      <p className="soft" style={{ maxWidth: "58ch", fontSize: 15, lineHeight: 1.6 }}>
        {detail ??
          "We couldn't reach the learning runtime, so we won't guess at your state. Your progress is safe on the backend — this is only a read."}
      </p>
      {message ? (
        <p className="mono quiet" style={{ fontSize: 11, wordBreak: "break-word" }}>
          {message}
        </p>
      ) : null}
      <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
        <Link href="/learner" className="btn">
          ↺ retry
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
