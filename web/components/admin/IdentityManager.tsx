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

// French display label for a role (the technical role id stays in the select values).
const ROLE_FR: Record<Role, string> = {
  SUPER_ADMIN: "super-admin",
  TENANT_ADMIN: "administrateur",
  TRAINER: "formateur",
  LEARNER: "apprenant",
};

function RolePill({ role }: { role: Role }) {
  return <span className={`${a.rolePill} ${ROLE_CLASS[role]}`}>{ROLE_FR[role]}</span>;
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
      setInviteErr(err instanceof Error ? err.message : "erreur réseau");
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
      setRoleErr(err instanceof Error ? err.message : "erreur réseau");
      setRoleBusy(false);
    }
  }

  const columns: Column<Record<string, unknown>>[] = [
    {
      key: "user",
      header: "Utilisateur",
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
      header: "Rôle (via l'appartenance)",
      render: (r) => <RolePill role={(r as unknown as MembershipRow).role} />,
    },
    { key: "scope", header: "Périmètre", mono: true },
    { key: "status", header: "Statut", mono: true },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (r) => {
        const m = r as unknown as MembershipRow;
        if (!m.manageable || !m.userId) {
          return <span className="quiet" style={{ fontSize: 9.5 }}>— {m.self ? "vous" : "lecture seule"} —</span>;
        }
        return (
          <button type="button" className={a.editBtn} onClick={() => openRoleEditor(m)}>
            changer le rôle ⤸
          </button>
        );
      },
    },
  ];

  const rows = memberships.map((m) => ({ ...m })) as unknown as Record<string, unknown>[];

  const roleDiff: FieldDiff[] = editing
    ? [{ field: "rôle", before: editing.role, after: nextRole }]
    : [];

  return (
    <div className="col" style={{ gap: 22 }}>
      <p className="soft" style={{ maxWidth: "62ch", margin: 0 }}>
        Un utilisateur n&apos;est rien tant qu&apos;il ne détient pas une <em>appartenance</em> dans ce tenant.
        L&apos;appartenance porte le rôle — le client ne peut jamais en demander un. Le runtime le dérive et
        l&apos;applique sur chaque route du tenant. Vous invitez les personnes, et vous leur accordez leur rôle.
      </p>

      {/* INVITE / CREATE USER */}
      <Panel
        kicker="Inviter"
        title="Ajouter un utilisateur et accorder son rôle"
        aside={<span className="mono quiet" style={{ fontSize: 11 }}>POST /v1/users · POST /v1/tenants/{tenantSlug}/memberships</span>}
      >
        <form onSubmit={submitInvite} className={a.inviteGrid} aria-label="Inviter un utilisateur">
          <div>
            <label className={a.fieldLabel} htmlFor="inv-name">Nom</label>
            <input
              id="inv-name"
              className={a.input}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nom complet"
              required
            />
          </div>
          <div>
            <label className={a.fieldLabel} htmlFor="inv-email">E-mail professionnel</label>
            <input
              id="inv-email"
              className={a.input}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="personne@org.test"
              required
            />
          </div>
          <div>
            <label className={a.fieldLabel} htmlFor="inv-role">Rôle</label>
            <select id="inv-role" className={a.select} value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {GRANTABLE.map((r) => (
                <option key={r} value={r}>{ROLE_FR[r]}</option>
              ))}
            </select>
          </div>
          <div className={a.inviteAction}>
            <button type="submit" className="btn primary" disabled={inviteBusy}>
              {inviteBusy ? "Invitation…" : "Inviter l'utilisateur →"}
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
              <b>{invited.name}</b> a été créé en tant que <b>{ROLE_FR[invited.role]}</b>. Partagez ce mot de passe
              temporaire <em>une seule fois</em> — il n&apos;est affiché qu&apos;une fois ici et n&apos;est pas stocké
              sous forme lisible :
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
                  {copied ? "copié ✓" : "copier"}
                </button>
              </span>
              <span className="mono quiet" style={{ display: "block", fontSize: 10.5, marginTop: 6 }}>
                identifiant {invited.email} · un e-mail d&apos;invitation a été envoyé (ou journalisé) · il devra définir son propre mot de passe à la première connexion
              </span>
            </span>
          </div>
        ) : null}
      </Panel>

      <div className={a.note}>
        <span className={a.noteIco} aria-hidden="true">⛬</span>
        <span>
          <b>Frontière OIDC de vérification seule.</b> Lorsque votre fournisseur d&apos;identité émet des jetons,
          LORE valide la signature <b>RS256</b> et les revendications — il ne génère jamais lui-même de jetons
          utilisateur. Le sujet est associé à une appartenance ; c&apos;est le rôle de l&apos;appartenance que le
          runtime applique.
        </span>
      </div>

      <Panel
        kicker="Appartenances"
        title="Les rôles sont accordés par l'appartenance"
        aside={<span className="mono quiet" style={{ fontSize: 11 }}>GET /v1/tenants/{tenantSlug}/memberships</span>}
      >
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => (r as unknown as MembershipRow).email}
          empty="Aucune appartenance."
        />
      </Panel>

      <div className={`${a.note} ${a.noteAmber}`}>
        <span className={a.noteIco} aria-hidden="true">▲</span>
        <span>
          <b>SUPER_ADMIN ne peut pas être accordé ici.</b> En tant que <b>TENANT_ADMIN</b>, vous pouvez accorder
          les appartenances TENANT_ADMIN, TRAINER et LEARNER dans <b>{tenantSlug}</b>. Seul le bootstrap de la
          plateforme / un SUPER_ADMIN existant peut accorder SUPER_ADMIN — c&apos;est inter-tenant et hors de votre
          autorité de tenant. Il est affiché en lecture seule pour que la frontière reste lisible.
        </span>
      </div>

      {/* ROLE-CHANGE DRAWER */}
      <Drawer
        open={!!editing}
        onClose={() => setEditing(null)}
        kicker="Appartenance · rôle"
        title={editing ? `Changer le rôle · ${editing.name}` : ""}
      >
        {editing ? (
          <div className="col" style={{ gap: 18 }}>
            <p className="soft" style={{ margin: 0 }}>
              Ré-accorder une appartenance met à jour (upsert) le rôle sur le backend. Le changement prend effet
              au prochain jeton porteur de l&apos;utilisateur ; son rôle de connexion local est gardé synchronisé.
            </p>
            <div>
              <label className={a.fieldLabel} htmlFor="role-next">Nouveau rôle</label>
              <select
                id="role-next"
                className={a.select}
                value={nextRole}
                onChange={(e) => setNextRole(e.target.value as Role)}
              >
                {GRANTABLE.map((r) => (
                  <option key={r} value={r}>{ROLE_FR[r]}</option>
                ))}
              </select>
            </div>
            <ReviewState
              diffs={roleDiff}
              impact={
                <>
                  Ceci ré-accorde l&apos;appartenance de <b>{editing.name}</b> dans <b>{tenantSlug}</b> en tant que{" "}
                  <strong className="mono">{nextRole}</strong>. Le runtime applique le nouveau rôle sur chaque
                  route du tenant à partir de son prochain jeton.
                </>
              }
              acknowledgement={
                <>Je comprends que cela change le rôle de <strong>{editing.name}</strong> en{" "}
                <strong className="mono">{nextRole}</strong>.</>
              }
              confirmLabel="Appliquer le changement de rôle"
              cancelLabel="Annuler"
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
