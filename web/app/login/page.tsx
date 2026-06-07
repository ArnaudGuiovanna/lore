import { redirect } from "next/navigation";
import { getSession, roleHome } from "@/lib/auth/session";
import { listCredentials } from "@/lib/auth/store";
import { LoginForm } from "@/components/auth/LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const session = await getSession();
  if (session) redirect(roleHome(session.role));

  // Demo logins are OFF by default. They are only surfaced when explicitly opted
  // in (LORE_SHOW_DEMO_LOGINS=1) — never expose seeded credentials in production.
  const showDemo = process.env.LORE_SHOW_DEMO_LOGINS === "1";
  const demo = showDemo
    ? (await listCredentials()).slice(0, 6).map((c) => ({ email: c.email, role: c.role, name: c.name }))
    : [];
  const demoPw = showDemo ? process.env.DEFAULT_SEED_PASSWORD || "lore123!" : "";

  return (
    <main className="wrap" style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", padding: "48px 24px" }}>
      <div className="reveal" style={{ width: "100%", maxWidth: 880, display: "grid", gridTemplateColumns: "1.1fr 1fr", gap: 40, alignItems: "center" }}>
        <div>
          <p className="kicker">Headless LMS · runtime-first</p>
          <h1 style={{ fontSize: "clamp(40px,6vw,66px)", marginTop: 16 }}>
            LORE<span style={{ color: "var(--accent)" }}>.</span>
          </h1>
          <p className="standfirst" style={{ marginTop: 12 }}>Sign in to your training space</p>
          <p className="soft measure" style={{ marginTop: 16, fontSize: 15 }}>
            Your role is <em>derived from your membership</em> — the runtime decides what you can do.
            Identity is verified against the LORE backend; the front never owns progression.
          </p>
          {demo.length > 0 && (
            <div className="panel" style={{ marginTop: 22, padding: 16 }}>
              <p className="kicker" style={{ marginBottom: 8 }}>Demo accounts · password <code>{demoPw}</code></p>
              <ul className="mono" style={{ listStyle: "none", padding: 0, margin: 0, fontSize: 12.5, lineHeight: 1.9 }}>
                {demo.map((d) => (
                  <li key={d.email} className="spread"><span>{d.email}</span><span className="quiet">{d.role}</span></li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <LoginForm firstEmail={demo[0]?.email} />
      </div>
    </main>
  );
}
