import { redirect } from "next/navigation";
import { listCredentials } from "@/lib/auth/store";
import { SetupWizard } from "@/components/auth/SetupWizard";

export const dynamic = "force-dynamic";

// First-run setup wizard. If the system is already initialized (a TENANT_ADMIN
// credential exists), /setup is locked and redirects to /login.
export default async function SetupPage() {
  const creds = await listCredentials();
  const initialized = creds.some((c) => c.role === "TENANT_ADMIN" || c.role === "SUPER_ADMIN");
  if (initialized) redirect("/login");

  return (
    <main className="wrap" style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", padding: "48px 24px" }}>
      <div className="reveal" style={{ width: "100%", maxWidth: 920, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 40, alignItems: "center" }}>
        <div>
          <p className="kicker">Première installation</p>
          <h1 style={{ fontSize: 24, fontWeight: 600, marginTop: 16 }}>
            Configurez LORE<span style={{ color: "var(--accent)" }}>.</span>
          </h1>
          <p className="standfirst" style={{ marginTop: 12 }}>Créez votre organisation et votre compte administrateur</p>
          <p className="soft measure" style={{ marginTop: 16, fontSize: 15 }}>
            Le système est vide. Cet assistant crée votre organisation (le tenant) et
            le premier compte <em>administrateur</em>. Aucune donnée de démonstration
            n&apos;est ajoutée. Vous serez connecté immédiatement après.
          </p>
        </div>
        <SetupWizard />
      </div>
    </main>
  );
}
