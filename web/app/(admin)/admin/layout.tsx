import type { ReactNode } from "react";
import { AppBar } from "@/components/ui/AppBar";
import { AppNav } from "@/components/ui/AppNav";

export const dynamic = "force-dynamic";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <AppBar role="admin" />
      {/* Lateral nav (UX-01): console sections (?section=…) + RGPD. */}
      <div className="wrap" style={{ paddingTop: 20 }}>
        <AppNav role="admin" />
      </div>
      {children}
    </>
  );
}
