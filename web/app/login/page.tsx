import { redirect } from "next/navigation";
import { getSession, roleHome } from "@/lib/auth/session";
import { listCredentials } from "@/lib/auth/store";
import { LoginForm } from "@/components/auth/LoginForm";
import { ThemeToggle } from "@/components/ui/ThemeToggle";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<{ joined?: string }>;
}) {
  const session = await getSession();
  if (session) redirect(roleHome(session.role));
  // B-23: a learner who just self-enrolled via /join/{code} lands here.
  const joined = (await searchParams)?.joined === "1";

  // If the system has never been initialized (no admin credential), send the
  // operator to the first-run setup wizard instead of an unusable login.
  const allCreds = await listCredentials();
  const initialized = allCreds.some((c) => c.role === "TENANT_ADMIN" || c.role === "SUPER_ADMIN");
  if (!initialized) redirect("/setup");

  // Demo logins are OFF by default. They are only surfaced when explicitly opted
  // in (LORE_SHOW_DEMO_LOGINS=1) — never expose seeded credentials in production.
  const showDemo = process.env.LORE_SHOW_DEMO_LOGINS === "1";
  const demo = showDemo
    ? allCreds.slice(0, 6).map((c) => ({ email: c.email, role: c.role, name: c.name }))
    : [];
  const demoPw = showDemo ? process.env.DEFAULT_SEED_PASSWORD || "lore123!" : "";

  return (
    <main style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", padding: "48px 24px", position: "relative" }}>
      <div style={{ position: "absolute", top: 20, right: 24 }}>
        <ThemeToggle />
      </div>
      <div className="reveal col" style={{ width: "100%", maxWidth: 340, gap: 28 }}>
        <div className="col" style={{ gap: 8 }}>
          <h1 className="mono" style={{ fontSize: 20, fontWeight: 500, letterSpacing: "0.02em" }}>
            lore<span style={{ color: "var(--accent)" }}>▮</span>
          </h1>
          <p className="dek" style={{ margin: 0 }}>LMS agentique — le runtime décide, le modèle génère.</p>
        </div>

        {joined ? (
          <p
            className="mono"
            role="status"
            data-testid="join-success"
            style={{ fontSize: 12.5, color: "var(--accent)", margin: 0 }}
          >
            ✓ Compte créé — connectez-vous.
          </p>
        ) : null}

        <LoginForm firstEmail={demo[0]?.email} />

        {demo.length > 0 && (
          <details className="mono" style={{ fontSize: 12 }}>
            <summary className="quiet" style={{ cursor: "pointer", listStyle: "none" }}>
              comptes de démonstration · <code>{demoPw}</code>
            </summary>
            <ul style={{ listStyle: "none", padding: 0, margin: "10px 0 0", lineHeight: 2 }}>
              {demo.map((d) => (
                <li key={d.email} className="spread">
                  <span>{d.email}</span>
                  <span className="quiet">{d.role}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </main>
  );
}
