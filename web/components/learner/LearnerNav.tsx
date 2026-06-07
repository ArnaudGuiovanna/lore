"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Stepper, type Step } from "@/components/ui/Stepper";

const SCREENS: { id: string; href: string; label: string; caption: string }[] = [
  { id: "now", href: "/learner", label: "Maintenant", caption: "lire & répondre" },
  { id: "provenance", href: "/learner/provenance", label: "Provenance", caption: "pourquoi ce parcours" },
  { id: "reviews", href: "/learner/reviews", label: "Révisions", caption: "rappel espacé" },
  { id: "progress", href: "/learner/progress", label: "Progression", caption: "signaux honnêtes" },
  { id: "history", href: "/learner/history", label: "Historique", caption: "instantanés" },
];

export function LearnerNav() {
  const pathname = usePathname();
  const router = useRouter();
  const active =
    SCREENS.slice()
      .reverse()
      .find((sc) => pathname === sc.href || (sc.href !== "/learner" && pathname.startsWith(sc.href)))
      ?.id ?? "now";

  // Every screen is freely reachable (no locked gates on navigation). The
  // Stepper only makes done/active steps clickable, so mark the active one
  // "active" and all others "done" — all selectable, calm and lateral.
  const steps: Step[] = SCREENS.map((sc) => ({
    id: sc.id,
    label: sc.label,
    caption: sc.caption,
    state: sc.id === active ? "active" : "done",
  }));

  return (
    <nav aria-label="Votre session" className="col" style={{ gap: 14 }}>
      <div className="spread" style={{ flexWrap: "wrap", gap: 12 }}>
        <Link href="/" className="mono quiet" style={{ fontSize: 12, textDecoration: "none" }}>
          ← LORE
        </Link>
      </div>
      <Stepper
        steps={steps}
        activeId={active}
        onSelect={(id) => {
          const target = SCREENS.find((sc) => sc.id === id);
          if (target) router.push(target.href);
        }}
      />
    </nav>
  );
}
