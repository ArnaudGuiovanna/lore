import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { PasswordForm } from "@/components/auth/PasswordForm";

export const dynamic = "force-dynamic";

// Set / change password. Reached either as a FORCED reset (invited users, first
// login — session.mustChange) or as a self-service change for any signed-in user.
export default async function AccountPasswordPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const forced = session.mustChange === true;

  return (
    <main className="wrap" style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", padding: "48px 24px" }}>
      <div className="reveal" style={{ width: "100%", maxWidth: 520 }}>
        <p className="kicker">{forced ? "Première connexion" : "Mon compte · sécurité"}</p>
        <h1 style={{ fontSize: 20, fontWeight: 600, marginTop: 12 }}>
          {forced ? "Choisissez votre mot de passe" : "Changer de mot de passe"}
          <span style={{ color: "var(--accent)" }}>.</span>
        </h1>
        <p className="soft measure" style={{ marginTop: 12, fontSize: 15 }}>
          {forced
            ? "Pour des raisons de sécurité, vous devez définir votre propre mot de passe avant d'accéder à votre espace."
            : "Saisissez votre mot de passe actuel, puis votre nouveau mot de passe."}
        </p>
        <p className="mono quiet" style={{ marginTop: 6, fontSize: 12 }}>
          {session.email}
        </p>
        <div style={{ marginTop: 22 }}>
          <PasswordForm forced={forced} />
        </div>
      </div>
    </main>
  );
}
