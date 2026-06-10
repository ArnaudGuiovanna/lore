import type { ReactNode } from "react";
import { AppBar } from "@/components/ui/AppBar";
import { AppNav } from "@/components/ui/AppNav";
import { getSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  // B-27 : un GESTIONNAIRE partage la surface admin mais sa nav est réduite
  // aux sections administratives (pas de LLM/graphe/outbox, pas de RGPD).
  const session = await getSession();
  const managerView = session?.role === "GESTIONNAIRE";
  return (
    <>
      <AppBar role="admin" />
      {/* Lateral nav (UX-01): console sections (?section=…) + RGPD. */}
      <div className="wrap" style={{ paddingTop: 20 }}>
        <AppNav role="admin" managerView={managerView} />
      </div>
      {children}
    </>
  );
}
