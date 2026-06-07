"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/ui/Panel";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Drawer } from "@/components/ui/Drawer";
import { ReviewState, type FieldDiff } from "@/components/ui/ReviewState";
import type { Role } from "@/lib/types";
import type { MembershipRow } from "./types";
import a from "./admin.module.css";

const ROLE_CLASS: Record<Role, string> = {
  SUPER_ADMIN: a.roleSuper,
  TENANT_ADMIN: a.roleAdmin,
  TRAINER: a.roleTrainer,
  LEARNER: a.roleLearner,
};

// A tenant admin may grant these (SUPER_ADMIN is cross-tenant — not offered).
const GRANTABLE: Role[] = ["TENANT_ADMIN", "TRAINER", "LEARNER"];

function RolePill({ role }: { role: Role }) {
  return <span className={`${a.rolePill} ${ROLE_CLASS[role]}`}>{role.toLowerCase()}</span>;
}

// Identity & memberships, now WRITABLE: invite/create users, and change a user's
// role by re-granting a membership (the backend treats AddMembership as an upsert).
// Role is always carried by the membership — the client never asks for a role for
// itself; an admin grants it to others.
export function IdentityManager({
  memberships,
  tenantSlug,
}: {
  memberships: MembershipRow[];
  tenantSlug: string;
}) {
  const router = useRouter();

  // ---- invite form state ----
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("LEARNER");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteErr, setInviteErr] = useState<string | null>(null);
  const [invited, setInvited] = useState<{ email: string; name: string; role: Role; tempPassword: string } | null>(null);
  const [copied, setCopied] = useState(false);

  // ---- role-change drawer state ----
  const [editing, setEditing] = useState<MembershipRow | null>(null);
  const [nextRole, setNextRole] = useState<Role>("LEARNER");
  const [roleBusy, setRoleBusy] = useState(false);
  const [roleErr, setRoleErr] = useState<string | null>(null);

  async function submitInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviteBusy(true);
    setInviteErr(null);
    setInvited(null);
    setCopied(false);
    try {
      const res = await fetch("/api/admin/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, name, role }),
      });
      const data = await res.json();
      if (!res.ok) {
        setInviteErr(data?.error || `HTTP ${res.status}`);
        setInviteBusy(false);
        return;
      }
      setInvited({ email: data.email, name: data.name, role: data.role, tempPassword: data.tempPassword });
      setEmail("");
      setName("");
      setRole("LEARNER");
      setInviteBusy(false);
      router.refresh(); // reflect the new membership in the table
    } catch (err) {
      setInviteErr(err instanceof Error ? err.message : "network error");
      setInviteBusy(false);
    }
  }

  function openRoleEditor(row: MembershipRow) {
    setEditing(row);
    setNextRole(row.role === "SUPER_ADMIN" ? "TENANT_ADMIN" : row.role);
    setRoleErr(null);
  }

  async function applyRole() {
    if (!editing?.userId) return;
    setRoleBusy(true);
    setRoleErr(null);
    try {
      const res = await fetch("/api/admin/membership", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: editing.userId, role: nextRole }),
      });
      const data = await res.json();
      if (!res.ok) {
        setRoleErr(data?.error || `HTTP ${res.status}`);
        setRoleBusy(false);
        return;
      }
      setRoleBusy(false);
      setEditing(null);
      router.refresh();
    } catch (err) {
      setRoleErr(err instanceof Error ? err.message : "network error");
      setRoleBusy(false);
    }
  }

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
    {
      key: "actions",
      header: "",
      align: "right",
      render: (r) => {
        const m = r as unknown as MembershipRow;
        if (!m.manageable || !m.userId) {
          return <span className="quiet" style={{ fontSize: 9.5 }}>— {m.self ? "you" : "read-only"} —</span>;
        }
        return (
          <button type="button" className={a.editBtn} onClick={() => openRoleEditor(m)}>
            change role ⤸
          </button>
        );
      },
    },
  ];

  const rows = memberships.map((m) => ({ ...m })) as unknown as Record<string, unknown>[];

  const roleDiff: FieldDiff[] = editing
    ? [{ field: "role", before: editing.role, after: nextRole }]
    : [];

  return (
    <div className="col" style={{ gap: 22 }}>
      <p className="soft" style={{ maxWidth: "62ch", margin: 0 }}>
        A user is nothing until they hold a <em>membership</em> in this tenant. The membership carries the
        role — the client can never ask for one. The runtime derives and enforces it on every tenant route.
        You invite people in, and you grant their role.
      </p>

      {/* INVITE / CREATE USER */}
      <Panel
        kicker="Invite"
        title="Add a user and grant their role"
        aside={<span className="mono quiet" style={{ fontSize: 11 }}>POST /v1/users · POST /v1/tenants/{tenantSlug}/memberships</span>}
      >
        <form onSubmit={submitInvite} className={a.inviteGrid} aria-label="Invite a user">
          <div>
            <label className={a.fieldLabel} htmlFor="inv-name">Name</label>
            <input
              id="inv-name"
              className={a.input}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Full name"
              required
            />
          </div>
          <div>
            <label className={a.fieldLabel} htmlFor="inv-email">Work email</label>
            <input
              id="inv-email"
              className={a.input}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="person@org.test"
              required
            />
          </div>
          <div>
            <label className={a.fieldLabel} htmlFor="inv-role">Role</label>
            <select id="inv-role" className={a.select} value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {GRANTABLE.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
          <div className={a.inviteAction}>
            <button type="submit" className="btn primary" disabled={inviteBusy}>
              {inviteBusy ? "Inviting…" : "Invite user →"}
            </button>
          </div>
        </form>

        {inviteErr ? (
          <p className="mono" role="alert" style={{ color: "var(--alarm)", fontSize: 13, marginTop: 14 }}>
            {inviteErr}
          </p>
        ) : null}

        {invited ? (
          <div className={`${a.note} ${a.noteAmber}`} style={{ marginTop: 16 }} role="status">
            <span className={a.noteIco} aria-hidden="true">⚷</span>
            <span>
              <b>{invited.name}</b> was created as <b>{invited.role}</b>. Share this temporary password{" "}
              <em>once</em> — it is shown here a single time and is not stored in readable form:
              <span className={a.tempPw}>
                <code>{invited.tempPassword}</code>
                <button
                  type="button"
                  className={a.editBtn}
                  onClick={() => {
                    navigator.clipboard?.writeText(invited.tempPassword);
                    setCopied(true);
                  }}
                >
                  {copied ? "copied ✓" : "copy"}
                </button>
              </span>
              <span className="mono quiet" style={{ display: "block", fontSize: 10.5, marginTop: 6 }}>
                login {invited.email} · an invitation email was sent (or logged) · they must set their own password on first sign-in
              </span>
            </span>
          </div>
        ) : null}
      </Panel>

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
          <b>SUPER_ADMIN cannot be granted from here.</b> As <b>TENANT_ADMIN</b> you may grant TENANT_ADMIN,
          TRAINER and LEARNER memberships within <b>{tenantSlug}</b>. Only the platform bootstrap / an existing
          SUPER_ADMIN may grant SUPER_ADMIN — it is cross-tenant and outside your tenant authority. It is
          shown read-only so the boundary stays legible.
        </span>
      </div>

      {/* ROLE-CHANGE DRAWER */}
      <Drawer
        open={!!editing}
        onClose={() => setEditing(null)}
        kicker="Membership · role"
        title={editing ? `Change role · ${editing.name}` : ""}
      >
        {editing ? (
          <div className="col" style={{ gap: 18 }}>
            <p className="soft" style={{ margin: 0 }}>
              Re-granting a membership upserts the role on the backend. The change takes effect on the
              user&apos;s next bearer token; their local login role is kept in sync.
            </p>
            <div>
              <label className={a.fieldLabel} htmlFor="role-next">New role</label>
              <select
                id="role-next"
                className={a.select}
                value={nextRole}
                onChange={(e) => setNextRole(e.target.value as Role)}
              >
                {GRANTABLE.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
            <ReviewState
              diffs={roleDiff}
              impact={
                <>
                  This re-grants <b>{editing.name}</b>&apos;s membership in <b>{tenantSlug}</b> as{" "}
                  <strong className="mono">{nextRole}</strong>. The runtime enforces the new role on every
                  tenant route from their next token onward.
                </>
              }
              acknowledgement={
                <>I understand this changes <strong>{editing.name}</strong>&apos;s role to{" "}
                <strong className="mono">{nextRole}</strong>.</>
              }
              confirmLabel="Apply role change"
              cancelLabel="Cancel"
              busy={roleBusy}
              error={roleErr}
              onConfirm={applyRole}
              onCancel={() => setEditing(null)}
            />
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}
