import type { ReactNode } from "react";
import Link from "next/link";
import { getSession } from "@/lib/auth/session";
import { UserMenu } from "@/components/auth/UserMenu";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { CommandMenu } from "@/components/learner/CommandMenu";
import { StatusLine } from "@/components/learner/StatusLine";
import { ConsentBanner } from "@/components/learner/ConsentBanner";

export const dynamic = "force-dynamic";

// The INVITE shell: 48px of chrome on top, 28px of modeline at the bottom,
// emptiness in between. No tabs, no tenant chip, no role chip, no banner —
// the runtime's sentence owns the screen. Everything else lives in the menu.
export default async function LearnerLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  return (
    <>
      <header
        style={{
          height: 48,
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "0 20px",
          borderBottom: "1px solid var(--line)",
        }}
      >
        <Link
          href="/learner"
          className="mono"
          aria-label="LORE — Maintenant"
          style={{ fontSize: 14, fontWeight: 500, letterSpacing: "0.02em", textDecoration: "none", color: "var(--ink)" }}
        >
          lore<span style={{ color: "var(--accent)" }}>▮</span>
        </Link>
        <span style={{ flex: 1 }} />
        <CommandMenu />
        <ThemeToggle />
        <UserMenu name={session?.name || ""} role="Apprenant" />
      </header>

      <div className="wrap" data-testid="learner-banner" style={{ maxWidth: 980, padding: "24px 24px 72px" }}>
        {/* B-28 : bannière persistante (non bloquante) tant que des textes
            légaux publiés n'ont pas été consentis dans leur version courante. */}
        <ConsentBanner />
        {children}
      </div>

      <StatusLine />
    </>
  );
}
