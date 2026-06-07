"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/ui/Panel";
import { Drawer } from "@/components/ui/Drawer";
import { ReviewState } from "@/components/ui/ReviewState";
import type { Role } from "@/lib/types";
import a from "./admin.module.css";

export interface RgpdUser {
  userId: string;
  name: string;
  email: string;
  role: Role;
  // Already erased (a tombstone exists)? Then actions are read-only.
  erased: boolean;
  erasedAt: string | null;
  self: boolean;
}

const ROLE_FR: Record<Role, string> = {
  SUPER_ADMIN: "super-admin",
  TENANT_ADMIN: "administrateur",
  TRAINER: "formateur",
  LEARNER: "apprenant",
};

// Admin RGPD console: per tenant user, export their personal-data bundle and
// erase/anonymize them (right to be forgotten). Honest that backend runtime traces
// remain pseudonymous by learner id after erasure.
export function RgpdConsole({ users, tenantName }: { users: RgpdUser[]; tenantName: string }) {
  const router = useRouter();
  const [erasing, setErasing] = useState<RgpdUser | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function confirmErase() {
    if (!erasing) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/admin/rgpd/erase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: erasing.userId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErr(data?.error || `HTTP ${res.status}`);
        setBusy(false);
        return;
      }
      setBusy(false);
      setErasing(null);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "erreur réseau");
      setBusy(false);
    }
  }

  return (
    <div className="col" style={{ gap: 22 }}>
      <p className="soft" style={{ maxWidth: "64ch", margin: 0 }}>
        Droits des personnes (RGPD) pour le tenant <strong>{tenantName}</strong>.
        Pour chaque utilisateur, vous pouvez <em>exporter</em> ses données
        personnelles (portabilité / accès) ou les <em>supprimer / anonymiser</em>
        (droit à l&apos;effacement).
      </p>

      <div className={a.note}>
        <span className={a.noteIco} aria-hidden="true">ⓘ</span>
        <span>
          <b>Honnêteté.</b> L&apos;effacement anonymise l&apos;identifiant de connexion
          (e-mail / nom) et les lignes d&apos;émargement, en conservant les lignes pour
          l&apos;intégrité de l&apos;audit. Les traces d&apos;apprentissage du moteur
          (états, snapshots) restent <b>pseudonymisées par identifiant apprenant</b> —
          elles ne contiennent pas de données nominatives et sont conservées par le
          backend.
        </span>
      </div>

      <Panel
        kicker="RGPD"
        title="Données personnelles par utilisateur"
        aside={
          <span className="mono quiet" style={{ fontSize: 11 }}>
            GET /api/admin/rgpd/export · POST /api/admin/rgpd/erase
          </span>
        }
      >
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left" }}>
                <th className="kicker" style={{ padding: "8px 8px", borderBottom: "1px solid var(--line)" }}>Utilisateur</th>
                <th className="kicker" style={{ padding: "8px 8px", borderBottom: "1px solid var(--line)" }}>Rôle</th>
                <th className="kicker" style={{ padding: "8px 8px", borderBottom: "1px solid var(--line)", textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 ? (
                <tr>
                  <td colSpan={3} className="quiet" style={{ padding: "16px 8px" }}>Aucun utilisateur.</td>
                </tr>
              ) : (
                users.map((u) => (
                  <tr key={u.userId} style={{ borderBottom: "1px solid var(--line)" }}>
                    <td style={{ padding: "10px 8px" }}>
                      <span style={{ fontFamily: "var(--serif)", fontSize: 15, color: "var(--ink)" }}>{u.name}</span>
                      <span className="mono quiet" style={{ display: "block", fontSize: 10.5 }}>
                        {u.email}{u.erased ? " · anonymisé" : ""}
                      </span>
                    </td>
                    <td className="mono" style={{ padding: "10px 8px", fontSize: 12 }}>{ROLE_FR[u.role]}</td>
                    <td style={{ padding: "10px 8px", textAlign: "right" }}>
                      <span className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
                        <a
                          className="btn"
                          href={`/api/admin/rgpd/export?userId=${encodeURIComponent(u.userId)}`}
                          style={{ padding: "6px 12px", fontSize: 12, textDecoration: "none" }}
                        >
                          Exporter (RGPD) ↓
                        </a>
                        {u.erased ? (
                          <span className="quiet" style={{ fontSize: 11 }}>— anonymisé —</span>
                        ) : u.self ? (
                          <span className="quiet" style={{ fontSize: 11 }}>— vous —</span>
                        ) : (
                          <button
                            type="button"
                            className="btn"
                            onClick={() => { setErasing(u); setErr(null); }}
                            style={{ padding: "6px 12px", fontSize: 12, color: "var(--alarm)", borderColor: "var(--alarm)" }}
                          >
                            Supprimer / anonymiser
                          </button>
                        )}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      <Drawer
        open={!!erasing}
        onClose={() => setErasing(null)}
        kicker="RGPD · effacement"
        title={erasing ? `Anonymiser · ${erasing.name}` : ""}
      >
        {erasing ? (
          <div className="col" style={{ gap: 18 }}>
            <p className="soft" style={{ margin: 0 }}>
              Cette action anonymise l&apos;identifiant de connexion de{" "}
              <strong>{erasing.name}</strong> (e-mail et nom remplacés, mot de passe
              invalidé) et ré-identifie ses lignes d&apos;émargement par un pseudonyme,
              en conservant les lignes pour l&apos;intégrité. Une preuve d&apos;effacement
              (sans donnée nominative) est enregistrée. <b>Action irréversible.</b>
            </p>
            <ReviewState
              diffs={[
                { field: "e-mail", before: erasing.email, after: "anonymisé" },
                { field: "nom", before: erasing.name, after: "Utilisateur supprimé (RGPD)" },
              ]}
              impact={
                <>
                  Les données nominatives de <b>{erasing.name}</b> sont anonymisées.
                  Les traces du moteur restent pseudonymisées par identifiant apprenant.
                </>
              }
              acknowledgement={
                <>Je comprends que cela anonymise définitivement <strong>{erasing.name}</strong>.</>
              }
              confirmLabel="Anonymiser (RGPD)"
              cancelLabel="Annuler"
              busy={busy}
              error={err}
              onConfirm={confirmErase}
              onCancel={() => setErasing(null)}
            />
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}
