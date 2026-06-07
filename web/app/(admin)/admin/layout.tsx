import type { ReactNode } from "react";
import { AppBar } from "@/components/ui/AppBar";

export const dynamic = "force-dynamic";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <AppBar role="admin" />
      {children}
    </>
  );
}
