"use client";

import { useEffect, useState } from "react";

// Light is the default; "dark" is the only persisted preference.
// The pre-paint init script in app/layout.tsx reads the same key.
export function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.dataset.theme === "dark");
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    if (next) {
      document.documentElement.dataset.theme = "dark";
      try { localStorage.setItem("lore-theme", "dark"); } catch { /* private mode */ }
    } else {
      delete document.documentElement.dataset.theme;
      try { localStorage.removeItem("lore-theme"); } catch { /* private mode */ }
    }
  }

  return (
    <button
      type="button"
      className="btn ghost mono"
      onClick={toggle}
      aria-label={dark ? "Passer en mode clair" : "Passer en mode sombre"}
      title={dark ? "Mode clair" : "Mode sombre"}
      style={{ fontSize: 11, padding: "5px 8px", letterSpacing: "0.06em" }}
    >
      {dark ? "[light]" : "[dark]"}
    </button>
  );
}
