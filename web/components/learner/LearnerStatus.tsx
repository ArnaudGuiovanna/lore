import type { ReactNode } from "react";
import Link from "next/link";
import { EmptyState, ErrorState } from "@/components/ui/States";

// Honest, on-brand status panels for the learner surface, built on the shared
// UX-02 state components. The runtime owns the truth; when we cannot reach it
// we say so plainly rather than fabricating an empty state. Mark "hors ligne"
// = the backend did not answer; a LearnerEmpty = a genuine, healthy emptiness.
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
    <ErrorState
      kicker={kicker}
      mark="hors ligne"
      detail={
        detail ??
        "Nous n'avons pas pu joindre le runtime d'apprentissage ; nous ne devinerons donc pas votre état. Votre progression est en sécurité sur le backend — ceci n'est qu'une lecture."
      }
      message={message}
      action={
        <Link href="/learner" className="btn">
          ↺ réessayer
        </Link>
      }
    />
  );
}

export function LearnerEmpty({
  kicker,
  children,
}: {
  kicker?: string;
  children: ReactNode;
}) {
  return <EmptyState kicker={kicker}>{children}</EmptyState>;
}
