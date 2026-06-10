// Admin console sections — the single source of truth shared by the console
// (rendering) and the lateral AppNav (links). Each section is addressable via
// /admin?section=… ; "overview" is the default and keeps a clean URL.
export type AdminSection =
  | "overview"
  | "identity"
  | "structure"
  | "sessions"
  | "import"
  | "graph"
  | "llm"
  | "outbox";

export const ADMIN_DEFAULT_SECTION: AdminSection = "overview";

export const ADMIN_SECTIONS: { id: AdminSection; label: string }[] = [
  { id: "overview", label: "Vue d'ensemble" },
  { id: "identity", label: "Identité" },
  { id: "structure", label: "Structure de l'organisation" },
  { id: "sessions", label: "Sessions" },
  { id: "import", label: "Import CSV" },
  { id: "graph", label: "Graphe du domaine" },
  { id: "llm", label: "Matrice LLM" },
  { id: "outbox", label: "Boîte d'événements" },
];

// Normalize an arbitrary ?section= value — unknown values fall back to the
// default rather than rendering a blank console.
export function asAdminSection(value: string | null | undefined): AdminSection {
  return ADMIN_SECTIONS.some((s) => s.id === value)
    ? (value as AdminSection)
    : ADMIN_DEFAULT_SECTION;
}
