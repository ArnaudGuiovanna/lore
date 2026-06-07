import type { Source } from "@/lib/runtime";
import { sourceLabel } from "@/lib/runtime";

// The provenance mark — always distinguishes runtime-decided vs llm-generated vs instruction-only.
export function Mark({ source, children }: { source: Source; children?: React.ReactNode }) {
  return <span className={`mark ${source}`}>{children ?? sourceLabel(source)}</span>;
}

export function Pill({ children, on = false }: { children: React.ReactNode; on?: boolean }) {
  return <span className={`pill ${on ? "on" : ""}`}>{children}</span>;
}
