// Admin console sections — the single source of truth shared by the console
// (rendering) and the lateral AppNav (links). Each section is addressable via
// /admin?section=… ; "overview" is the default and keeps a clean URL.
export type AdminSection =
  | "overview"
  | "identity"
  | "structure"
  | "sessions"
  | "import"
  | "invites"
  | "graph"
  | "llm"
  | "outbox"
  | "conformite";

export const ADMIN_DEFAULT_SECTION: AdminSection = "overview";

export const ADMIN_SECTIONS: { id: AdminSection; label: string }[] = [
  { id: "overview", label: "Vue d'ensemble" },
  { id: "identity", label: "Identité" },
  { id: "structure", label: "Structure de l'organisation" },
  { id: "sessions", label: "Sessions" },
  { id: "import", label: "Import CSV" },
  { id: "invites", label: "Invitations" },
  { id: "graph", label: "Graphe du domaine" },
  { id: "llm", label: "Matrice LLM" },
  { id: "outbox", label: "Boîte d'événements" },
  { id: "conformite", label: "Conformité" },
];

// B-27 — le GESTIONNAIRE (rôle administratif : inscriptions, sessions,
// documents, financements, qualité) atterrit sur la console admin mais ne voit
// JAMAIS la configuration technique (LLM, graphe, outbox) ni la vue d'ensemble
// pilotée par la config LLM. Le backend refuse de toute façon ces lectures.
export const MANAGER_SECTIONS: AdminSection[] = [
  "identity",
  "structure",
  "sessions",
  "import",
  "invites",
  "conformite",
];

export const MANAGER_DEFAULT_SECTION: AdminSection = "identity";

// Sections visible for a given admin-surface role.
export function adminSectionsForRole(role?: string): { id: AdminSection; label: string }[] {
  if (role === "GESTIONNAIRE") {
    return ADMIN_SECTIONS.filter((s) => MANAGER_SECTIONS.includes(s.id));
  }
  return ADMIN_SECTIONS;
}

export function adminDefaultSectionForRole(role?: string): AdminSection {
  return role === "GESTIONNAIRE" ? MANAGER_DEFAULT_SECTION : ADMIN_DEFAULT_SECTION;
}

// Normalize an arbitrary ?section= value — unknown (or role-forbidden) values
// fall back to the role's default rather than rendering a blank console.
export function asAdminSection(value: string | null | undefined, role?: string): AdminSection {
  return adminSectionsForRole(role).some((s) => s.id === value)
    ? (value as AdminSection)
    : adminDefaultSectionForRole(role);
}
