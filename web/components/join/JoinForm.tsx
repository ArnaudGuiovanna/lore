"use client";

// B-23 — public account-creation form for /join/{code}. Posts to /api/join
// (no session) ; on success the new learner is sent to /login with a notice.
import { useState } from "react";
import { useRouter } from "next/navigation";

export function JoinForm({ code }: { code: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Le mot de passe doit contenir au moins 8 caractères.");
      return;
    }
    if (password !== password2) {
      setError("Les deux mots de passe ne correspondent pas.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, name, email, password }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error || `Inscription impossible (HTTP ${res.status})`);
        setBusy(false);
        return;
      }
      router.push("/login?joined=1");
    } catch {
      setError("Le serveur est injoignable. Réessayez.");
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="panel"
      aria-label="Créer mon compte"
      style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 22 }}
    >
      <label className="col" style={{ gap: 6 }}>
        <span className="kicker">Nom complet</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="name"
          required
          style={inputStyle}
          data-testid="join-name"
        />
      </label>
      <label className="col" style={{ gap: 6 }}>
        <span className="kicker">E-mail</span>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
          style={inputStyle}
          data-testid="join-email"
        />
      </label>
      <label className="col" style={{ gap: 6 }}>
        <span className="kicker">Mot de passe (8 caractères minimum)</span>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          required
          minLength={8}
          style={inputStyle}
          data-testid="join-password"
        />
      </label>
      <label className="col" style={{ gap: 6 }}>
        <span className="kicker">Confirmez le mot de passe</span>
        <input
          type="password"
          value={password2}
          onChange={(e) => setPassword2(e.target.value)}
          autoComplete="new-password"
          required
          minLength={8}
          style={inputStyle}
          data-testid="join-password2"
        />
      </label>
      {error ? (
        <p className="mono" role="alert" data-testid="join-error" style={{ fontSize: 12.5, color: "var(--alarm)", margin: 0 }}>
          {error}
        </p>
      ) : null}
      <button type="submit" className="btn primary" disabled={busy} style={{ marginTop: 4 }} data-testid="join-submit">
        {busy ? "Création du compte…" : "Créer mon compte →"}
      </button>
      <p className="mono quiet" style={{ fontSize: 11, margin: 0 }}>
        Vous avez déjà un compte ? <a href="/login" style={{ color: "var(--accent)" }}>Connectez-vous</a>.
      </p>
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
