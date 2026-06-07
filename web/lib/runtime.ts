// Helpers to keep the UI honest about the headless runtime model.
import type { LLMConfiguration } from "./types";

export const ROLES = ["LEARNER", "TRAINER", "TENANT_ADMIN"] as const;

export function pct(x: number | undefined | null, digits = 2): string {
  if (x === undefined || x === null || Number.isNaN(x)) return "—";
  return x.toFixed(digits);
}

export function isInstructionOnly(cfg?: Pick<LLMConfiguration, "provider"> | null): boolean {
  return (cfg?.provider || "").toLowerCase() === "instruction_only";
}

// The single source-of-truth distinction the UI must always make visible.
export type Source = "runtime" | "llm" | "fallbk";
export function sourceLabel(s: Source): string {
  return s === "runtime" ? "décidé par le runtime" : s === "llm" ? "généré par le LLM" : "instruction seule";
}

// Human label for the trainer/admin alert types.
export function alertLabel(type: string): string {
  const map: Record<string, string> = {
    LearnerAtRisk: "Apprenant à risque",
    ReviewDue: "Révision à faire",
    LowRetention: "Faible rétention",
    Plateau: "Plateau",
    ZpdDrift: "Dérive de la ZPD",
    Overload: "Surcharge",
    MasteryReadiness: "Prêt pour la maîtrise",
    Misconception: "Conception erronée active",
  };
  return map[type] || type;
}

export function relativeTime(iso?: string | null): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  // Deterministic on the server; refined client-side if needed.
  const d = new Date(iso);
  return d.toISOString().slice(0, 16).replace("T", " ") + " UTC";
}
