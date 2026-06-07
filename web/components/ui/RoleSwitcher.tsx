"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { classNames } from "@/lib/format";
import styles from "./AppBar.module.css";

export type SurfaceRole = "learner" | "trainer" | "admin";

const SURFACES: { id: SurfaceRole; href: string; label: string }[] = [
  { id: "learner", href: "/learner", label: "apprenant" },
  { id: "trainer", href: "/trainer", label: "formateur" },
  { id: "admin", href: "/admin", label: "administrateur" },
];

// A demo affordance: jump between the three role surfaces. The real role is
// derived from membership — this is labelled subtly ("view as") to make that clear.
export function RoleSwitcher({ active }: { active?: SurfaceRole }) {
  const pathname = usePathname();
  const current =
    active ??
    SURFACES.find((sc) => pathname === sc.href || pathname.startsWith(sc.href + "/"))?.id ??
    SURFACES.find((sc) => pathname.startsWith("/" + sc.id))?.id;

  return (
    <div className={styles.switcher} aria-label="Voir en tant que rôle">
      <span className={styles.switchLabel}>voir en tant que</span>
      <div className={styles.seg} role="tablist">
        {SURFACES.map((sc) => {
          const isActive = sc.id === current;
          return (
            <Link
              key={sc.id}
              href={sc.href}
              role="tab"
              aria-selected={isActive}
              aria-current={isActive ? "page" : undefined}
              className={classNames(styles.segItem, isActive && styles.active)}
            >
              {sc.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
