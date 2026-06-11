"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function LoginForm({ firstEmail }: { firstEmail?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState(firstEmail || "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || "Échec de la connexion");
        setBusy(false);
        return;
      }
      router.push(data.redirect || "/");
      router.refresh();
    } catch {
      setError("Le runtime est injoignable. Réessayez.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="col" style={{ gap: 14 }} aria-label="Se connecter">
      <label className="col" style={{ gap: 6 }}>
        <span className="kicker">E-mail professionnel</span>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="username"
          required
          style={inputStyle}
        />
      </label>
      <label className="col" style={{ gap: 6 }}>
        <span className="kicker">Mot de passe</span>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
          style={inputStyle}
        />
      </label>
      {error && (
        <p className="mono" role="alert" style={{ fontSize: 12.5, color: "var(--alarm)", margin: 0 }}>
          {error}
        </p>
      )}
      <button type="submit" className="btn primary" disabled={busy} style={{ marginTop: 2 }}>
        {busy ? "Connexion…" : "Continuer"}
      </button>
    </form>
  );
}

const inputStyle: React.CSSProperties = {
  fontFamily: "var(--mono)",
  fontSize: 13.5,
  padding: "9px 11px",
  borderRadius: 6,
  border: "1px solid var(--line-2)",
  background: "var(--card)",
  color: "var(--ink)",
};
