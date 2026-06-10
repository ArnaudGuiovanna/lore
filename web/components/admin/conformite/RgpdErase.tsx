"use client";

// B-14 — effacement RGPD côté backend : purge des traces du runtime d'UN
// apprenant (états, activités, snapshots, révisions…) + tombstone d'identité.
// Double confirmation : il faut RETAPER le nom exact de l'apprenant.
// Complémentaire de /admin/rgpd (anonymisation du tiers web : identifiants de
// connexion + émargement).
import { useMemo, useState } from "react";
import Link from "next/link";
import { Panel } from "@/components/ui/Panel";
import type { NamedRef } from "./Conformite";
import a from "../admin.module.css";

export function RgpdErase({ learners }: { learners: NamedRef[] }) {
  const [learnerId, setLearnerId] = useState(learners[0]?.id ?? "");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ name: string; erased: Record<string, number> } | null>(null);

  const selected = useMemo(() => learners.find((l) => l.id === learnerId), [learners, learnerId]);
  const confirmed = !!selected && typed.trim() === selected.name;

  async function erase() {
    if (!selected || !confirmed) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/admin/rgpd/erase-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ learnerId: selected.id }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        erased?: Record<string, number>;
      };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setResult({ name: selected.name, erased: data.erased ?? {} });
      setTyped("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "effacement impossible");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="col" style={{ gap: 22 }}>
      <div className={a.note}>
        <span className={a.noteIco} aria-hidden="true">ⓘ</span>
        <span>
          <b>Deux registres, deux effacements.</b> Cet écran purge les traces du{" "}
          <b>backend</b> (états d&apos;apprentissage, activités, snapshots, révisions) et
          tombstone l&apos;identité. L&apos;anonymisation des identifiants de connexion et
          de l&apos;émargement (tiers web) se fait dans{" "}
          <Link href="/admin/rgpd" style={{ color: "var(--accent)" }}>RGPD · données personnelles</Link>.
        </span>
      </div>

      <Panel
        kicker="RGPD · droit à l'effacement"
        title="Effacer les données d'un apprenant (backend)"
        aside={<span className="mono quiet" style={{ fontSize: 11 }}>DELETE /learners/…/data · irréversible</span>}
      >
        <div className="col" style={{ gap: 14, maxWidth: 560 }}>
          <label className="col" style={{ gap: 4 }}>
            <span className="quiet mono" style={{ fontSize: 11 }}>apprenant</span>
            <select
              value={learnerId}
              onChange={(e) => {
                setLearnerId(e.target.value);
                setTyped("");
                setResult(null);
                setError(null);
              }}
              data-testid="rgpd-learner"
            >
              {learners.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </label>

          {selected ? (
            <>
              <p className="soft" style={{ margin: 0, fontSize: 14, lineHeight: 1.6 }}>
                Cette action purge définitivement les traces d&apos;apprentissage de{" "}
                <strong>{selected.name}</strong> dans le moteur et tombstone son identité
                côté backend. <b>Action irréversible.</b> Pour confirmer, tapez le nom
                exact de l&apos;apprenant ci-dessous.
              </p>
              <label className="col" style={{ gap: 4 }}>
                <span className="quiet mono" style={{ fontSize: 11 }}>
                  tapez « {selected.name} » pour confirmer
                </span>
                <input
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  placeholder={selected.name}
                  data-testid="rgpd-confirm-name"
                />
              </label>
              <div>
                <button
                  type="button"
                  className="btn"
                  style={{ color: "var(--alarm)", borderColor: "var(--alarm)" }}
                  disabled={!confirmed || busy}
                  onClick={() => void erase()}
                  data-testid="rgpd-erase-submit"
                >
                  {busy ? "Effacement…" : "Effacer les données (irréversible)"}
                </button>
              </div>
            </>
          ) : (
            <p className="quiet" style={{ margin: 0 }}>Aucun apprenant dans le tenant.</p>
          )}

          {error ? (
            <p className="mono" style={{ color: "var(--alarm)", fontSize: 12, margin: 0 }}>{error}</p>
          ) : null}

          {result ? (
            <div className="panel col" style={{ gap: 8 }} data-testid="rgpd-erase-result">
              <span className="pill on">données effacées · {result.name}</span>
              <p className="quiet mono" style={{ fontSize: 12, margin: 0 }}>
                {Object.keys(result.erased).length === 0
                  ? "aucune trace à purger (l'apprenant n'avait pas d'historique)"
                  : Object.entries(result.erased)
                      .map(([k, v]) => `${k} : ${v}`)
                      .join(" · ")}
              </p>
              <p className="soft" style={{ fontSize: 13, margin: 0 }}>
                L&apos;audit garde l&apos;action (compteurs de lignes, sans donnée nominative).
              </p>
            </div>
          ) : null}
        </div>
      </Panel>
    </div>
  );
}
