import type { ReactNode } from "react";
import { AppBar } from "@/components/ui/AppBar";
import { AppNav } from "@/components/ui/AppNav";
import { ConsentBanner } from "@/components/learner/ConsentBanner";
import { activeLearner } from "@/components/learner/data";

export const dynamic = "force-dynamic";

export default async function LearnerLayout({ children }: { children: ReactNode }) {
  const learner = await activeLearner();
  return (
    <>
      <AppBar role="learner" />
      <div className="wrap" style={{ maxWidth: 980, padding: "40px 24px 96px" }}>
      <header className="col" style={{ gap: 18 }}>
        <AppNav role="learner" />
        <div className="spread" style={{ flexWrap: "wrap", gap: 10, alignItems: "baseline" }}>
          <p className="kicker" data-testid="learner-banner">Apprenant · {learner.name}</p>
          <span className="mono quiet" style={{ fontSize: 11 }}>
            groupe Go-Spring-24 · tuteur en instruction seule
          </span>
        </div>
      </header>
      <div style={{ marginTop: 28 }}>
        {/* B-28 : bannière persistante (non bloquante) tant que des textes
            légaux publiés n'ont pas été consentis dans leur version courante. */}
        <ConsentBanner />
        {children}
      </div>
      </div>
    </>
  );
}
