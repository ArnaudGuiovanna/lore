import { Panel } from "@/components/ui/Panel";
import { DataTable, type Column } from "@/components/ui/DataTable";
import type { Role } from "@/lib/types";
import type { MembershipRow } from "./types";
import a from "./admin.module.css";

const ROLE_CLASS: Record<Role, string> = {
  SUPER_ADMIN: a.roleSuper,
  TENANT_ADMIN: a.roleAdmin,
  TRAINER: a.roleTrainer,
  LEARNER: a.roleLearner,
};

function RolePill({ role }: { role: Role }) {
  return <span className={`${a.rolePill} ${ROLE_CLASS[role]}`}>{role.toLowerCase()}</span>;
}

// Identity & memberships: role is granted by membership; the client can never
// request a role. OIDC verify-only boundary; SUPER_ADMIN is read-only here.
export function Identity({ memberships, tenantSlug }: { memberships: MembershipRow[]; tenantSlug: string }) {
  const columns: Column<Record<string, unknown>>[] = [
    {
      key: "user",
      header: "User",
      render: (r) => {
        const m = r as unknown as MembershipRow;
        return (
          <div className="col" style={{ gap: 2 }}>
            <span style={{ fontFamily: "var(--serif)", fontSize: 16, color: "var(--ink)", fontWeight: 500 }}>
              {m.name}
            </span>
            <span className="mono quiet" style={{ fontSize: 11 }}>{m.email}</span>
          </div>
        );
      },
    },
    {
      key: "role",
      header: "Role (via membership)",
      render: (r) => <RolePill role={(r as unknown as MembershipRow).role} />,
    },
    { key: "scope", header: "Scope", mono: true },
    { key: "status", header: "Status", mono: true },
  ];

  const rows = memberships.map((m) => ({ ...m })) as unknown as Record<string, unknown>[];

  return (
    <div className="col" style={{ gap: 22 }}>
      <p className="soft" style={{ maxWidth: "62ch", margin: 0 }}>
        A user is nothing until they hold a <em>membership</em> in this tenant. The membership carries the
        role — the client can never ask for one. The runtime derives and enforces it on every tenant route.
      </p>

      <div className={a.note}>
        <span className={a.noteIco} aria-hidden="true">⛬</span>
        <span>
          <b>OIDC verify-only boundary.</b> When your identity provider issues tokens, LORE validates the{" "}
          <b>RS256</b> signature and claims — it never mints user tokens itself. The subject is mapped to a
          membership; the membership&apos;s role is what the runtime enforces.
        </span>
      </div>

      <Panel
        kicker="Memberships"
        title="Roles are granted by membership"
        aside={<span className="mono quiet" style={{ fontSize: 11 }}>GET /v1/tenants/{tenantSlug}/memberships</span>}
      >
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => (r as unknown as MembershipRow).email}
          empty="No memberships."
        />
      </Panel>

      <div className={`${a.note} ${a.noteAmber}`}>
        <span className={a.noteIco} aria-hidden="true">▲</span>
        <span>
          <b>SUPER_ADMIN cannot be granted from here.</b> As <b>TENANT_ADMIN</b> you may grant TRAINER and
          LEARNER memberships within <b>{tenantSlug}</b>. Only the platform bootstrap / an existing
          SUPER_ADMIN may grant SUPER_ADMIN — it is cross-tenant and outside your tenant authority. It is
          shown read-only so the boundary stays legible.
        </span>
      </div>
    </div>
  );
}
