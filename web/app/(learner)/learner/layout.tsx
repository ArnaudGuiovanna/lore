import type { ReactNode } from "react";
import { AppBar } from "@/components/ui/AppBar";
import { LearnerNav } from "@/components/learner/LearnerNav";
import { activeLearner } from "@/components/learner/data";

export const dynamic = "force-dynamic";

export default async function LearnerLayout({ children }: { children: ReactNode }) {
  const learner = await activeLearner();
  return (
    <>
      <AppBar role="learner" />
      <div className="wrap" style={{ maxWidth: 980, padding: "40px 24px 96px" }}>
      <header className="col" style={{ gap: 18 }}>
        <LearnerNav />
        <div className="spread" style={{ flexWrap: "wrap", gap: 10, alignItems: "baseline" }}>
          <p className="kicker">Learner · {learner.name}</p>
          <span className="mono quiet" style={{ fontSize: 11 }}>
            cohort Go-Spring-24 · tutor instruction-only
          </span>
        </div>
      </header>
      <div style={{ marginTop: 28 }}>{children}</div>
      </div>
    </>
  );
}
