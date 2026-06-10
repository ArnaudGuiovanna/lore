"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { ErrorState, LoadingState } from "@/components/ui/States";
import type { CohortInvite } from "@/lib/types";
import type { ManagedProgram } from "./types";

type Row = CohortInvite & Record<string, unknown>;

function fmtDate(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" });
}

// Honest status: same rules as the backend's usability check, computed for display.
function inviteStatus(i: CohortInvite): { label: string; active: boolean } {
  if (i.revoked_at) return { label: "révoquée", active: false };
  if (i.expires_at && Date.now() > Date.parse(i.expires_at)) return { label: "expirée", active: false };
  if (i.max_uses > 0 && i.use_count >= i.max_uses) return { label: "épuisée", active: false };
  return { label: "active", active: true };
}

// Invitation links manager (B-23): mint shareable self-enrollment codes per
// cohort, list them with their consumption, revoke at any time.
export function InvitesManager({
  programs,
  publicBaseUrl,
}: {
  programs: ManagedProgram[];
  publicBaseUrl?: string;
}) {
  const cohorts = useMemo(
    () => programs.flatMap((p) => p.cohorts.map((c) => ({ ...c, programName: p.name }))),
    [programs]
  );
  const [cohortId, setCohortId] = useState(cohorts[0]?.id ?? "");
  const [invites, setInvites] = useState<CohortInvite[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [form, setForm] = useState({ expiresInHours: 168, maxUses: 0 });

  // The shareable link base: a TRUSTED configured public URL when the operator
  // set one, else the current origin (the admin shares what they can see).
  const linkBase =
    (publicBaseUrl || "").replace(/\/+$/, "") ||
    (typeof window !== "undefined" ? window.location.origin : "");
  const joinUrl = useCallback((code: string) => `${linkBase}/join/${code}`, [linkBase]);

  const refresh = useCallback(async () => {
    if (!cohortId) {
      setInvites([]);
      return;
    }
    setLoadError(null);
    try {
      const res = await fetch(`/api/admin/invites?cohortId=${encodeURIComponent(cohortId)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setInvites(((await res.json()) as CohortInvite[]) ?? []);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "chargement impossible");
      setInvites([]);
    }
  }, [cohortId]);

  useEffect(() => {
    setInvites(null);
    void refresh();
  }, [refresh]);

  const create = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!cohortId) {
        setError("sélectionnez un groupe");
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const res = await fetch("/api/admin/invites", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cohortId,
            expires_in_hours: Number(form.expiresInHours) || 0,
            max_uses: Number(form.maxUses) || 0,
          }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "création impossible");
      } finally {
        setBusy(false);
      }
    },
    [cohortId, form, refresh]
  );

  const revoke = useCallback(
    async (id: string) => {
      setBusy(true);
      try {
        await fetch(`/api/admin/invites/${encodeURIComponent(id)}`, { method: "DELETE" });
        await refresh();
      } finally {
        setBusy(false);
      }
    },
    [refresh]
  );

  const copy = useCallback(
    async (invite: CohortInvite) => {
      try {
        await navigator.clipboard.writeText(joinUrl(invite.code));
        setCopiedId(invite.id);
        setTimeout(() => setCopiedId((c) => (c === invite.id ? null : c)), 2000);
      } catch {
        // clipboard unavailable (permissions) — the link is still selectable in the cell
      }
    },
    [joinUrl]
  );

  const columns: Column<Row>[] = [
    {
      key: "link",
      header: "Lien à partager",
      render: (r) => (
        <div className="col" style={{ gap: 4 }}>
          <span
            className="mono"
            style={{ fontSize: 11, wordBreak: "break-all" }}
            data-testid="invite-link"
            data-code={r.code}
          >
            {joinUrl(r.code)}
          </span>
          <button
            type="button"
            className="btn ghost"
            style={{ fontSize: 11, alignSelf: "flex-start", padding: "2px 8px" }}
            onClick={() => void copy(r)}
            data-testid="invite-copy"
          >
            {copiedId === r.id ? "✓ copié" : "copier le lien"}
          </button>
        </div>
      ),
    },
    {
      key: "status",
      header: "Statut",
      render: (r) => {
        const st = inviteStatus(r);
        return (
          <span className={`pill ${st.active ? "on" : ""}`} data-testid="invite-status">
            {st.label}
          </span>
        );
      },
    },
    {
      key: "uses",
      header: "Utilisations",
      align: "right",
      mono: true,
      render: (r) => (
        <span data-testid="invite-uses">
          {r.use_count}/{r.max_uses > 0 ? r.max_uses : "∞"}
        </span>
      ),
    },
    {
      key: "expires_at",
      header: "Expire le",
      mono: true,
      render: (r) => <span>{r.expires_at ? fmtDate(r.expires_at) : "jamais"}</span>,
    },
    { key: "created_at", header: "Créée le", mono: true, render: (r) => <span>{fmtDate(r.created_at)}</span> },
    {
      key: "actions",
      header: "",
      render: (r) =>
        inviteStatus(r).active ? (
          <button
            type="button"
            className="btn ghost"
            style={{ fontSize: 12 }}
            disabled={busy}
            onClick={() => void revoke(r.id)}
            data-testid="invite-revoke"
          >
            révoquer
          </button>
        ) : null,
    },
  ];

  return (
    <div className="col" style={{ gap: 22 }}>
      <Panel
        kicker="Auto-inscription (B-23)"
        title="Invitations par lien"
        aside={
          <label className="col" style={{ gap: 4 }}>
            <span className="quiet mono" style={{ fontSize: 11 }}>groupe</span>
            <select
              value={cohortId}
              onChange={(e) => setCohortId(e.target.value)}
              data-testid="invite-cohort"
            >
              {cohorts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        }
      >
        <p className="soft" style={{ maxWidth: "62ch", marginBottom: 14, fontSize: 14 }}>
          Un lien d&apos;invitation permet à un apprenant de créer lui-même son compte et de
          rejoindre le groupe — sans import CSV ni mot de passe temporaire. Le code est un
          secret : révoquez-le dès qu&apos;il ne doit plus circuler.
        </p>
        {invites === null ? (
          <LoadingState label="Chargement des invitations…" />
        ) : loadError && invites.length === 0 ? (
          <ErrorState
            kicker="La liste des invitations n'a pas répondu"
            detail="Les invitations persistées n'ont pas pu être lues — rien n'est inventé pour combler le manque. Les liens déjà partagés continuent de fonctionner côté backend."
            message={loadError}
            action={
              <button type="button" className="btn" onClick={() => void refresh()}>
                ↺ réessayer
              </button>
            }
          />
        ) : (
          <DataTable<Row>
            columns={columns}
            rows={(invites as Row[]) ?? []}
            rowKey={(r) => r.id}
            empty="Aucune invitation pour ce groupe — créez la première ci-dessous."
          />
        )}
      </Panel>

      <Panel kicker="Nouvelle invitation" title="Créer un lien d'invitation">
        <form onSubmit={create} className="col" style={{ gap: 12, maxWidth: 560 }} aria-label="Créer une invitation">
          <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
            <label className="col" style={{ gap: 4 }}>
              <span className="quiet mono" style={{ fontSize: 11 }}>validité (heures, 0 = sans expiration)</span>
              <input
                type="number"
                min={0}
                value={form.expiresInHours}
                onChange={(e) => setForm((f) => ({ ...f, expiresInHours: Number(e.target.value) }))}
                style={{ width: 160 }}
                data-testid="invite-expires"
              />
            </label>
            <label className="col" style={{ gap: 4 }}>
              <span className="quiet mono" style={{ fontSize: 11 }}>utilisations max (0 = illimité)</span>
              <input
                type="number"
                min={0}
                value={form.maxUses}
                onChange={(e) => setForm((f) => ({ ...f, maxUses: Number(e.target.value) }))}
                style={{ width: 160 }}
                data-testid="invite-max-uses"
              />
            </label>
          </div>
          {error ? (
            <p className="mono" style={{ color: "var(--alarm)", fontSize: 12 }}>{error}</p>
          ) : null}
          <div>
            <button
              type="submit"
              className="btn primary"
              disabled={busy || cohorts.length === 0}
              data-testid="invite-create"
            >
              {busy ? "…" : "Créer l'invitation"}
            </button>
          </div>
        </form>
      </Panel>
    </div>
  );
}
