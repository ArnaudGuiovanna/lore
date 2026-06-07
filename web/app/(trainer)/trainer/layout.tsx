import type { ReactNode } from "react";
import { AppBar } from "@/components/ui/AppBar";

export const dynamic = "force-dynamic";

export default function TrainerLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <AppBar role="trainer" />
      {children}
    </>
  );
}
