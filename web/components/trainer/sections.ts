// Trainer console sections — the single source of truth shared by the console
// (rendering) and the lateral AppNav (links). Each section is addressable via
// /trainer?section=… ; "design" is the default and keeps a clean URL.
export type TrainerSection =
  | "design"
  | "author"
  | "attach"
  | "path"
  | "versions"
  | "health"
  | "alerts"
  | "inspection"
  | "intervention";

export const TRAINER_DEFAULT_SECTION: TrainerSection = "design";

export const TRAINER_SECTIONS: { id: TrainerSection; label: string }[] = [
  { id: "design", label: "Concevoir" },
  { id: "author", label: "Rédiger" },
  { id: "attach", label: "Rattacher un groupe" },
  { id: "path", label: "Parcours" },
  { id: "versions", label: "Versions" },
  { id: "health", label: "Santé du groupe" },
  { id: "alerts", label: "Alertes" },
  { id: "inspection", label: "Inspection" },
  { id: "intervention", label: "Intervention" },
];

// Normalize an arbitrary ?section= value — unknown values fall back to the
// default rather than rendering a blank console.
export function asTrainerSection(value: string | null | undefined): TrainerSection {
  return TRAINER_SECTIONS.some((s) => s.id === value)
    ? (value as TrainerSection)
    : TRAINER_DEFAULT_SECTION;
}
