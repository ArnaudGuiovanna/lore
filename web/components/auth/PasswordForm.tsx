"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

const MIN_LENGTH = 10;

// Password set/change form. In FORCED mode (first login) the current-password
// field is hidden; otherwise the user must confirm their current password.
export function PasswordForm({ forced }: { forced: boolean }) {
  const router = useRouter();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (next.length < MIN_LENGTH) {
      setError(`Le mot de passe doit comporter au moins ${MIN_LENGTH} caractères.`);
      return;
    }
    if (next !== confirm) {
      setError("Les mots de passe ne correspondent pas.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword: forced ? undefined : current,
          newPassword: next,
          confirmPassword: confirm,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || "La mise à jour a échoué.");
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
    <form onSubmit={submit} className="panel" style={{ display: "flex", flexDirection: "column", gap: 14 }} aria-label="Changer de mot de passe">
      {!forced && (
        <label className="col" style={{ gap: 6 }}>
          <span className="kicker">Mot de passe actuel</span>
          <input
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
            required
            style={inputStyle}
          />
        </label>
      )}
      <label className="col" style={{ gap: 6 }}>
        <span className="kicker">Nouveau mot de passe</span>
        <input
          type="password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          autoComplete="new-password"
          minLength={MIN_LENGTH}
          required
          style={inputStyle}
        />
      </label>
      <label className="col" style={{ gap: 6 }}>
        <span className="kicker">Confirmer le mot de passe</span>
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          minLength={MIN_LENGTH}
          required
          style={inputStyle}
        />
      </label>
      <p className="mono quiet" style={{ fontSize: 11, margin: 0 }}>
        Au moins {MIN_LENGTH} caractères.
      </p>
      {error && (
        <p className="mono" role="alert" style={{ fontSize: 12.5, color: "var(--alarm)", margin: 0 }}>
          {error}
        </p>
      )}
      <button type="submit" className="btn primary" disabled={busy} style={{ marginTop: 4 }}>
        {busy ? "Enregistrement…" : "Enregistrer →"}
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
