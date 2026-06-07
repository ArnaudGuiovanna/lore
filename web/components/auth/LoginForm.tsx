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
        setError(data?.error || "Sign-in failed");
        setBusy(false);
        return;
      }
      router.push(data.redirect || "/");
      router.refresh();
    } catch {
      setError("The runtime is unreachable. Try again.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="panel" style={{ display: "flex", flexDirection: "column", gap: 14 }} aria-label="Sign in">
      <label className="col" style={{ gap: 6 }}>
        <span className="kicker">Work email</span>
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
        <span className="kicker">Password</span>
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
      <button type="submit" className="btn primary" disabled={busy} style={{ marginTop: 4 }}>
        {busy ? "Signing in…" : "Continue →"}
      </button>
      <p className="mono quiet" style={{ fontSize: 11, margin: 0 }}>
        bearer JWT · role from membership · tenant-scoped
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
