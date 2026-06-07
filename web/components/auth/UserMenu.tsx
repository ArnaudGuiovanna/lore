"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function UserMenu({ name, role }: { name: string; role: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.push("/login");
      router.refresh();
    }
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
      <span className="mono" style={{ fontSize: 12, color: "var(--ink)" }} title={role}>
        {name || "Compte"}
      </span>
      <button
        onClick={signOut}
        disabled={busy}
        className="btn ghost"
        style={{ fontSize: 12, padding: "6px 12px" }}
      >
        {busy ? "…" : "Se déconnecter"}
      </button>
    </span>
  );
}
