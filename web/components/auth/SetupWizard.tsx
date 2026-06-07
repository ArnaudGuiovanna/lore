"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

const MIN_PASSWORD = 10;

// First-run setup form: organization + admin identity + password (with confirm).
// On submit -> POST /api/setup which provisions everything and opens the session.
export function SetupWizard() {
  const router = useRouter();
  const [orgName, setOrgName] = useState("");
  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [bootstrapToken, setBootstrapToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < MIN_PASSWORD) {
      setError(`Le mot de passe doit comporter au moins ${MIN_PASSWORD} caractères.`);
      return;
    }
    if (password !== confirmPassword) {
      setError("Les mots de passe ne correspondent pas.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgName, adminName, adminEmail, password, confirmPassword, bootstrapToken }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || "La configuration a échoué.");
        setBusy(false);
        return;
      }
      router.push(data.redirect || "/admin");
      router.refresh();
    } catch {
      setError("Le runtime est injoignable. Réessayez.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="panel" style={{ display: "flex", flexDirection: "column", gap: 14 }} aria-label="Configuration initiale">
      <label className="col" style={{ gap: 6 }}>
        <span className="kicker">Nom de l&apos;organisation</span>
        <input
          type="text"
          value={orgName}
          onChange={(e) => setOrgName(e.target.value)}
          autoComplete="organization"
          required
          style={inputStyle}
        />
      </label>
      <label className="col" style={{ gap: 6 }}>
        <span className="kicker">Nom de l&apos;administrateur</span>
        <input
          type="text"
          value={adminName}
          onChange={(e) => setAdminName(e.target.value)}
          autoComplete="name"
          required
          style={inputStyle}
        />
      </label>
      <label className="col" style={{ gap: 6 }}>
        <span className="kicker">E-mail de l&apos;administrateur</span>
        <input
          type="email"
          value={adminEmail}
          onChange={(e) => setAdminEmail(e.target.value)}
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
          autoComplete="new-password"
          minLength={MIN_PASSWORD}
          required
          style={inputStyle}
        />
      </label>
      <label className="col" style={{ gap: 6 }}>
        <span className="kicker">Confirmer le mot de passe</span>
        <input
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          autoComplete="new-password"
          minLength={MIN_PASSWORD}
          required
          style={inputStyle}
        />
      </label>
      <p className="mono quiet" style={{ fontSize: 11, margin: 0 }}>
        Au moins {MIN_PASSWORD} caractères.
      </p>
      <label className="col" style={{ gap: 6 }}>
        <span className="kicker">Jeton opérateur</span>
        <input
          type="password"
          value={bootstrapToken}
          onChange={(e) => setBootstrapToken(e.target.value)}
          autoComplete="off"
          required
          style={inputStyle}
        />
        <span className="mono quiet" style={{ fontSize: 11 }}>
          La valeur de <code>LORE_BOOTSTRAP_TOKEN</code> définie au déploiement (preuve d&apos;opérateur).
        </span>
      </label>
      {error && (
        <p className="mono" role="alert" style={{ fontSize: 12.5, color: "var(--alarm)", margin: 0 }}>
          {error}
        </p>
      )}
      <button type="submit" className="btn primary" disabled={busy} style={{ marginTop: 4 }}>
        {busy ? "Configuration…" : "Créer l'organisation →"}
      </button>
    </form>
  );
}

const inputStyle: React.CSSProperties = {
  fontFamily: "var(--mono)",
  fontSize: 14,
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid var(--line-2)",
  background: "var(--paper)",
  color: "var(--ink)",
};
