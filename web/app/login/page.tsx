import { redirect } from "next/navigation";
import { getSession, roleHome } from "@/lib/auth/session";
import { listCredentials } from "@/lib/auth/store";
import { LoginForm } from "@/components/auth/LoginForm";

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
    <main className="wrap" style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", padding: "48px 24px" }}>
      <div className="reveal" style={{ width: "100%", maxWidth: 880, display: "grid", gridTemplateColumns: "1.1fr 1fr", gap: 40, alignItems: "center" }}>
        <div>
          <p className="kicker">LMS headless · runtime-first</p>
          <h1 style={{ fontSize: "clamp(40px,6vw,66px)", marginTop: 16 }}>
            LORE<span style={{ color: "var(--accent)" }}>.</span>
          </h1>
          <p className="standfirst" style={{ marginTop: 12 }}>Connectez-vous à votre espace de formation</p>
          <p className="soft measure" style={{ marginTop: 16, fontSize: 15 }}>
            Votre rôle est <em>issu de votre appartenance</em> — le runtime décide de ce que vous pouvez faire.
            L&apos;identité est vérifiée auprès du backend LORE ; le front ne pilote jamais la progression.
          </p>
          {demo.length > 0 && (
            <div className="panel" style={{ marginTop: 22, padding: 16 }}>
              <p className="kicker" style={{ marginBottom: 8 }}>Comptes de démonstration · mot de passe <code>{demoPw}</code></p>
              <ul className="mono" style={{ listStyle: "none", padding: 0, margin: 0, fontSize: 12.5, lineHeight: 1.9 }}>
                {demo.map((d) => (
                  <li key={d.email} className="spread"><span>{d.email}</span><span className="quiet">{d.role}</span></li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <div className="col" style={{ gap: 14 }}>
          {joined ? (
            <p
              className="panel mono"
              role="status"
              data-testid="join-success"
              style={{ fontSize: 12.5, padding: "12px 16px", color: "var(--accent)", margin: 0 }}
            >
              ✓ Compte créé — connectez-vous avec votre e-mail et le mot de passe que vous avez choisi.
            </p>
          ) : null}
          <LoginForm firstEmail={demo[0]?.email} />
        </div>
      </div>
    </main>
  );
}
