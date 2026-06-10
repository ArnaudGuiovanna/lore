"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { classNames } from "@/lib/format";
import {
  TRAINER_DEFAULT_SECTION,
  TRAINER_SECTIONS,
} from "@/components/trainer/sections";
import {
  ADMIN_DEFAULT_SECTION,
  ADMIN_SECTIONS,
  MANAGER_DEFAULT_SECTION,
  MANAGER_SECTIONS,
} from "@/components/admin/sections";
import styles from "./AppNav.module.css";

export type AppNavRole = "learner" | "trainer" | "admin";

// One nav item = a pathname, plus an optional ?section= when the destination
// is a console section rather than a page. Only real, living destinations are
// listed — no dead entries for future surfaces.
interface NavItem {
  path: string;
  section?: string;
  label: string;
  title?: string;
  testId?: string;
}

const LEARNER_ITEMS: NavItem[] = [
  { path: "/learner", label: "Maintenant", title: "lire & répondre" },
  { path: "/learner/path", label: "Parcours", title: "modules & déblocage" },
  { path: "/learner/provenance", label: "Provenance", title: "pourquoi ce parcours" },
  { path: "/learner/reviews", label: "Révisions", title: "rappel espacé" },
  { path: "/learner/progress", label: "Progression", title: "signaux honnêtes" },
  { path: "/learner/history", label: "Historique", title: "instantanés" },
  { path: "/learner/agenda", label: "Agenda", title: "sessions" },
  { path: "/learner/assignments", label: "Devoirs", title: "rendus & notes", testId: "learner-nav-assignments" },
  { path: "/learner/documents", label: "Documents", title: "convention, programme, règlement", testId: "learner-nav-documents" },
  { path: "/learner/surveys", label: "Mon avis", title: "enquêtes & réclamations", testId: "learner-nav-surveys" },
  { path: "/learner/resources", label: "Ressources", title: "fichiers & liens du formateur", testId: "learner-nav-resources" },
];

const TRAINER_ITEMS: NavItem[] = [
  ...TRAINER_SECTIONS.map((s): NavItem => ({ path: "/trainer", section: s.id, label: s.label })),
  { path: "/trainer/emargement", label: "Émargement", title: "présences & feuilles signées" },
];

const ADMIN_ITEMS: NavItem[] = [
  ...ADMIN_SECTIONS.map(
    (s): NavItem => ({ path: "/admin", section: s.id, label: s.label, testId: `admin-nav-${s.id}` })
  ),
  { path: "/admin/rgpd", label: "RGPD", title: "données personnelles", testId: "admin-nav-rgpd" },
];

// B-27 — la nav d'un GESTIONNAIRE : mêmes mécanismes que l'admin, mais
// seulement les sections administratives (pas de LLM, graphe, outbox ni RGPD).
const MANAGER_ITEMS: NavItem[] = ADMIN_SECTIONS.filter((s) => MANAGER_SECTIONS.includes(s.id)).map(
  (s): NavItem => ({ path: "/admin", section: s.id, label: s.label, testId: `admin-nav-${s.id}` })
);

const NAV: Record<AppNavRole, { label: string; items: NavItem[]; defaultSection?: string }> = {
  learner: { label: "Navigation apprenant", items: LEARNER_ITEMS },
  trainer: { label: "Sections du formateur", items: TRAINER_ITEMS, defaultSection: TRAINER_DEFAULT_SECTION },
  admin: { label: "Sections d'administration", items: ADMIN_ITEMS, defaultSection: ADMIN_DEFAULT_SECTION },
};

// The shared per-role navigation (UX-01). Client component: the active state
// depends on the current pathname and ?section=, and shallow history updates
// from the consoles are reflected here too. `managerView` narrows the admin
// surface to the GESTIONNAIRE's administrative sections.
export function AppNav({ role, managerView = false }: { role: AppNavRole; managerView?: boolean }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const base = NAV[role];
  const { label, items, defaultSection } =
    role === "admin" && managerView
      ? { label: base.label, items: MANAGER_ITEMS, defaultSection: MANAGER_DEFAULT_SECTION as string }
      : base;
  const rawSection = search.get("section");
  // Unknown ?section= values resolve to the default, mirroring the consoles.
  const currentSection = items.some((it) => it.section === rawSection) ? rawSection : defaultSection;

  return (
    <nav aria-label={label} className={styles.nav}>
      {items.map((it) => {
        const active =
          pathname === it.path && (it.section === undefined || it.section === currentSection);
        const href =
          it.section && it.section !== defaultSection ? `${it.path}?section=${it.section}` : it.path;
        return (
          <Link
            key={`${it.path}#${it.section ?? ""}`}
            href={href}
            className={classNames(styles.item, active && styles.on)}
            aria-current={active ? "page" : undefined}
            title={it.title}
            data-testid={it.testId}
          >
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}
