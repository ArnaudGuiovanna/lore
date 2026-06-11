"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

// The learner's single navigation surface: a command-menu overlay. The eleven
// former tabs become palette destinations — nothing is removed, everything
// leaves the screen. Opened by the visible "menu" button (novices) or ⌘K/Ctrl+K.
const GROUPS: { label: string; items: { path: string; label: string; hint?: string; testId?: string }[] }[] = [
  {
    label: "apprendre",
    items: [
      { path: "/learner", label: "Maintenant", hint: "l'étape en cours" },
      { path: "/learner/path", label: "Parcours", hint: "modules & déblocage" },
      { path: "/learner/reviews", label: "Révisions", hint: "rappels espacés" },
      { path: "/learner/progress", label: "Progression", hint: "par concept" },
      { path: "/learner/history", label: "Historique", hint: "instantanés" },
      { path: "/learner/provenance", label: "Pourquoi ce parcours", hint: "provenance" },
    ],
  },
  {
    label: "dossier",
    items: [
      { path: "/learner/assignments", label: "Devoirs", hint: "rendus & notes", testId: "learner-nav-assignments" },
      { path: "/learner/agenda", label: "Agenda", hint: "sessions" },
      { path: "/learner/documents", label: "Documents", hint: "convention, programme", testId: "learner-nav-documents" },
      { path: "/learner/resources", label: "Ressources", hint: "fichiers du formateur", testId: "learner-nav-resources" },
      { path: "/learner/surveys", label: "Mon avis", hint: "enquêtes & réclamations", testId: "learner-nav-surveys" },
    ],
  },
];

export function CommandMenu() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <button
        type="button"
        className="btn ghost mono"
        data-testid="learner-menu"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        style={{ fontSize: 11, padding: "5px 9px", letterSpacing: "0.06em" }}
      >
        menu <span className="quiet" aria-hidden="true">⌘K</span>
      </button>

      {open ? (
        <div
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
          style={{
            position: "fixed",
            inset: 0,
            background: "var(--scrim)",
            zIndex: 60,
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            paddingTop: "16vh",
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Menu apprenant"
            className="card col"
            style={{ width: "min(420px, calc(100vw - 48px))", padding: 10, gap: 14, maxHeight: "62vh", overflowY: "auto" }}
          >
            {GROUPS.map((g) => (
              <div key={g.label} className="col" style={{ gap: 2 }}>
                <span className="kicker" style={{ padding: "6px 10px 4px" }}>{g.label}</span>
                {g.items.map((it) => (
                  <Link
                    key={it.path}
                    href={it.path}
                    data-testid={it.testId}
                    onClick={() => setOpen(false)}
                    className="spread"
                    style={{
                      textDecoration: "none",
                      padding: "7px 10px",
                      borderRadius: 6,
                      gap: 16,
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "var(--paper-2)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                  >
                    <span style={{ fontSize: 13.5 }}>{it.label}</span>
                    {it.hint ? <span className="mono quiet" style={{ fontSize: 10.5 }}>{it.hint}</span> : null}
                  </Link>
                ))}
              </div>
            ))}
            <span className="mono quiet" style={{ fontSize: 10, padding: "0 10px 6px" }}>esc pour fermer</span>
          </div>
        </div>
      ) : null}
    </>
  );
}
