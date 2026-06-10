import Link from "next/link";
import { api, tpath } from "@/lib/api";
import { getSession } from "@/lib/auth/session";
import { listCredentials } from "@/lib/auth/store";
import { listErasures } from "@/lib/rgpd/erasures";
import { learnerDisplay, loadTenantContext } from "@/lib/tenant-context";
import type { Membership, Role } from "@/lib/types";
import { RgpdConsole, type RgpdUser } from "@/components/admin/RgpdConsole";

export const dynamic = "force-dynamic";

function asArray<T>(r: { ok: boolean; data?: unknown }): T[] {
  return r.ok && Array.isArray(r.data) ? (r.data as T[]) : [];
}

// Admin RGPD surface: list the tenant's users and offer per-user export + erasure.
// Users are derived from live memberships (source of truth for who-holds-which-role)
// joined with the credential store + backend learner list for names/emails.
export default async function RgpdPage() {
  const session = await getSession();
  const ctx = await loadTenantContext();

  const [membershipsRes, creds, erasures] = await Promise.all([
    api.get<Membership[]>(tpath("/memberships")),
    listCredentials(),
    listErasures(),
  ]);

  const erasedByUser = new Map(erasures.map((e) => [e.subjectUserId, e]));
  const nameFor = (userId: string): { name: string; email: string } => {
    const c = creds.find((x) => x.userId === userId);
    if (c) return { name: c.name, email: c.email };
    return learnerDisplay(ctx, userId);
  };

  const memberships = asArray<Membership>(membershipsRes);

  // Prefer live memberships; fall back to the credential store if the backend
  // returned none (honest local identities), mirroring the Identity surface.
  const base: { userId: string; role: Role }[] = memberships.length
    ? memberships.map((m) => ({ userId: m.user_id, role: m.role }))
    : creds.map((c) => ({ userId: c.userId, role: c.role }));

  const users: RgpdUser[] = base
    .map(({ userId, role }): RgpdUser => {
      const who = nameFor(userId);
      const tomb = erasedByUser.get(userId);
      return {
        userId,
        name: who.name,
        email: who.email,
        role,
        erased: !!tomb,
        erasedAt: tomb?.createdAt ?? null,
        self: userId === session?.userId,
      };
    })
    .sort((a, b) => {
      const order: Record<Role, number> = { SUPER_ADMIN: 0, TENANT_ADMIN: 1, TRAINER: 2, LEARNER: 3 };
      return order[a.role] - order[b.role] || a.name.localeCompare(b.name, "fr");
    });

  return (
    <main style={{ minHeight: "100vh" }}>
      <div className="wrap" style={{ paddingTop: 28, paddingBottom: 90 }}>
        <div className="spread" style={{ marginBottom: 18, flexWrap: "wrap", gap: 10 }}>
          <Link href="/admin" className="mono quiet" style={{ fontSize: 12 }}>
            ← Console admin
          </Link>
          <span className="mono quiet" style={{ fontSize: 11, letterSpacing: "0.05em" }}>
            tenant {ctx.tenantSlug} · TENANT_ADMIN · RGPD
          </span>
        </div>

        <header className="col" style={{ gap: 6, marginBottom: 22 }}>
          <span className="kicker">RGPD / Données personnelles</span>
          <h1 className="standfirst" style={{ margin: 0 }}>Droits des personnes</h1>
        </header>

        <RgpdConsole
          users={users}
          tenantName={ctx.tenantName || ctx.tenantSlug}
        />
      </div>
    </main>
  );
}
