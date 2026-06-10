// B-23 — public self-enrollment landing: /join/{code}. No session required —
// the unguessable invite code is the only credential. The server component
// resolves the code against the backend; the form posts to /api/join.
import { BACKEND_BASE } from "@/lib/config";
import type { InviteLookup } from "@/lib/types";
import { JoinForm } from "@/components/join/JoinForm";

export const dynamic = "force-dynamic";

async function lookupInvite(code: string): Promise<InviteLookup | null> {
  try {
    const res = await fetch(`${BACKEND_BASE}/v1/invites/${encodeURIComponent(code)}`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as InviteLookup;
  } catch {
    return null;
  }
}

export default async function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const invite = await lookupInvite(code);

  return (
    <main className="wrap" style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", padding: "48px 24px" }}>
      <div className="reveal" style={{ width: "100%", maxWidth: 560 }}>
        <p className="kicker">Auto-inscription · lien d&apos;invitation</p>
        <h1 style={{ fontSize: "clamp(32px,5vw,48px)", marginTop: 12 }} data-testid="join-title">
          Rejoindre la formation
        </h1>

        {!invite ? (
          <section className="panel" role="alert" style={{ marginTop: 22 }} data-testid="join-invalid">
            <p className="kicker" style={{ color: "var(--alarm)" }}>Invitation introuvable</p>
            <p className="soft" style={{ marginTop: 10, maxWidth: "52ch" }}>
              Ce lien d&apos;invitation n&apos;existe pas ou n&apos;est plus valide. Vérifiez le lien
              transmis par votre organisme de formation, ou demandez-lui une nouvelle invitation.
            </p>
          </section>
        ) : !invite.usable ? (
          <section className="panel" role="alert" style={{ marginTop: 22 }} data-testid="join-unusable">
            <p className="kicker" style={{ color: "var(--alarm)" }}>Invitation inutilisable</p>
            <p className="soft" style={{ marginTop: 10, maxWidth: "52ch" }} data-testid="join-reason">
              {invite.reason || "Cette invitation ne peut plus être utilisée."}
            </p>
            <p className="mono quiet" style={{ fontSize: 11, marginTop: 12 }}>
              {invite.tenant_name} · {invite.cohort_name}
            </p>
          </section>
        ) : (
          <>
            <p className="soft" style={{ marginTop: 12, maxWidth: "52ch" }}>
              <strong>{invite.tenant_name}</strong> vous invite à rejoindre le groupe{" "}
              <strong data-testid="join-cohort-name">{invite.cohort_name}</strong>. Créez votre
              compte apprenant pour démarrer — votre mot de passe reste votre choix.
            </p>
            <JoinForm code={code} />
          </>
        )}
      </div>
    </main>
  );
}
