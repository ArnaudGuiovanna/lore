import type { ReactNode } from "react";
import { AppBar } from "@/components/ui/AppBar";
import { AppNav } from "@/components/ui/AppNav";

export const dynamic = "force-dynamic";

export default function TrainerLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <AppBar role="trainer" />
      {/* Lateral nav (UX-01): console sections (?section=…) + Émargement. */}
      <div className="wrap" style={{ paddingTop: 20 }}>
        <AppNav role="trainer" />
      </div>
      {children}
    </>
  );
}
