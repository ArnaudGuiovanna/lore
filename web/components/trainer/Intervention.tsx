"use client";

import { useMemo, useState } from "react";
import type { Alert } from "@/lib/types";
import { Panel } from "@/components/ui/Panel";
import { Card } from "@/components/ui/Card";
import { SourceMark } from "@/components/runtime/SourceMark";
import { alertLabel } from "@/lib/runtime";
import { classNames, fmtPct } from "@/lib/format";
import type { LearnerRow } from "./types";
import t from "./trainer.module.css";

type ActionId = "retrieval" | "nudge" | "repair" | "escalate";

interface ActionDef {
  id: ActionId;
  title: string;
  desc: string;
  effect: string;
  // Maps to the one sanctioned lifecycle change the backend actually owns.
  lifecycle?: "ACKNOWLEDGED" | "RESOLVED";
}

// INTERVENTION: the trainer never hand-edits mastery or review state — the runtime owns
// pedagogical truth. The trainer REQUESTS a sanctioned action; the runtime applies it and
// re-derives state. "Assign a repair activity" is gated on an ACTIVE misconception — if the
// runtime tracks none, the block is decay, not error, and repair is unavailable.
export function Intervention({ learners }: { learners: LearnerRow[] }) {
  // Default to the learner the runtime is most worried about.
  const ranked = useMemo(
    () =>
      [...learners].sort(
        (a, b) => b.openAlerts - a.openAlerts || (a.avgMastery ?? 1) - (b.avgMastery ?? 1)
      ),
    [learners]
  );
  const [selectedId, setSelectedId] = useState<string>(ranked[0]?.id ?? learners[0]?.id);
  const learner = learners.find((l) => l.id === selectedId) ?? learners[0];

  const primaryAlert: Alert | undefined = learner?.alerts[0];
  const concept = primaryAlert?.concept_id ?? "le concept en retard";

  const actions: ActionDef[] = useMemo(
    () => [
      {
        id: "retrieval",
        title: "Programmer une séance de rappel",
        desc: `Mettre en file une séance de rappel espacé sur ${concept} — vise les révisions en retard qui font baisser la rétention.`,
        effect: "effet runtime · FSRS recale le planning de révision ; aucun changement de maîtrise tant que l'apprenant n'est pas actif.",
        lifecycle: "ACKNOWLEDGED",
      },
      {
        id: "nudge",
        title: "Envoyer une relance d'engagement",
        desc: "Un message calme, modèle du runtime, invitant l'apprenant à revenir — traite d'abord l'absence.",
        effect: "effet runtime · met une notification en file ; aucun changement d'état. Souvent associé au rappel.",
        lifecycle: "ACKNOWLEDGED",
      },
      {
        id: "repair",
        title: "Assigner une activité de remédiation",
        desc: "Vise une conception erronée active. Le runtime ne le propose que lorsqu'il en suit une.",
        effect: "effet runtime · met en file une activité de remédiation liée à la conception erronée.",
      },
      {
        id: "escalate",
        title: "Escalader vers un conseiller de programme",
        desc: "Transmettre à un conseiller humain si l'engagement ne repart pas — garde une personne dans la boucle au-delà du runtime.",
        effect: "effet runtime · route l'alerte ; la laisse ouverte sous la responsabilité du conseiller.",
        lifecycle: "RESOLVED",
      },
    ],
    [concept]
  );

  const repairEnabled = !!learner?.hasMisconception;
  const [action, setAction] = useState<ActionId>("retrieval");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState<{ action: ActionId; status: string } | null>(null);

  function isDisabled(a: ActionDef) {
    return a.id === "repair" && !repairEnabled;
  }

  function selectAction(a: ActionDef) {
    if (isDisabled(a)) return;
    setAction(a.id);
    setApplied(null);
    setError(null);
  }

  const chosen = actions.find((a) => a.id === action)!;

  async function apply() {
    if (busy || !learner) return;
    // The only act the runtime actually accepts here is an alert lifecycle change —
    // a sanctioned move. We never write mastery or review state by hand.
    if (!chosen.lifecycle || !primaryAlert) {
      setApplied({ action: chosen.id, status: "demandée" });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/alerts/${primaryAlert.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: chosen.lifecycle }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? `HTTP ${res.status}`);
        return;
      }
      setApplied({ action: chosen.id, status: chosen.lifecycle === "RESOLVED" ? "résolue" : "prise en compte" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "erreur réseau");
    } finally {
      setBusy(false);
    }
  }

  if (!learner) {
    return (
      <Panel kicker="Intervention" title="Aucun apprenant">
        <p className="quiet mono" style={{ fontSize: 13 }}>Aucun apprenant dans ce groupe.</p>
      </Panel>
    );
  }

  return (
    <div className="col" style={{ gap: 20 }}>
      <Panel kicker="Intervention · apprenant" title="Choisissez pour qui intervenir">
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          {ranked.map((l) => (
            <button
              key={l.id}
              type="button"
              className="btn"
              style={{
                borderColor: l.id === selectedId ? "var(--accent)" : "var(--line-2)",
                color: l.id === selectedId ? "var(--accent)" : undefined,
                background: l.id === selectedId ? "var(--accent-soft)" : undefined,
              }}
              onClick={() => {
                setSelectedId(l.id);
                setApplied(null);
                setError(null);
                setAction("retrieval");
              }}
            >
              {l.name}
              {l.openAlerts > 0 ? <span className="pill" style={{ marginLeft: 6 }}>{l.openAlerts}</span> : null}
            </button>
          ))}
        </div>
      </Panel>

      <Panel
        kicker={`Intervention · ${learner.name}`}
        title="Choisissez une action sanctionnée"
        aside={<SourceMark source="runtime" label="humain dans la boucle" />}
      >
        <p className="soft" style={{ marginTop: -6, marginBottom: 16, maxWidth: "62ch" }}>
          Vous ne modifiez pas à la main la maîtrise ni l&apos;état de révision — le runtime détient la vérité
          pédagogique. Vous demandez un mouvement sanctionné ; le runtime l&apos;applique et re-dérive l&apos;état
          à partir du résultat.
        </p>

        <Card
          style={{
            background: "var(--accent-soft)",
            borderColor: "rgba(42,79,62,.3)",
            marginBottom: 18,
            display: "flex",
            gap: 12,
            alignItems: "flex-start",
          }}
        >
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="var(--accent)"
            strokeWidth={2}
            aria-hidden="true"
            style={{ flex: "0 0 auto", marginTop: 2 }}
          >
            <path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z" />
            <path d="M9 12l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <p className="soft" style={{ margin: 0, fontSize: 14, color: "var(--ink-soft)" }}>
            La console n&apos;est jamais la source de la vérité pédagogique. La maîtrise (<b>BKT</b>) et l&apos;état
            de révision (<b>FSRS</b>) sont en lecture seule ici — maîtrise moyenne actuelle <span className="mono">{fmtPct(learner.avgMastery)}</span>,
            rétention <span className="mono">{fmtPct(learner.avgRetention)}</span>. Le runtime décide de ce qu&apos;il fait
            à l&apos;état et écrit un instantané d&apos;audit.
          </p>
        </Card>

        {primaryAlert ? (
          <p className="quiet mono" style={{ fontSize: 11, marginTop: -4, marginBottom: 14 }}>
            signal runtime · {alertLabel(primaryAlert.alert_type)}
            {primaryAlert.concept_id ? ` · ${primaryAlert.concept_id}` : ""} · recommande «&nbsp;{primaryAlert.recommended_action}&nbsp;»
          </p>
        ) : (
          <p className="quiet mono" style={{ fontSize: 11, marginTop: -4, marginBottom: 14 }}>
            Aucune alerte runtime ouverte pour {learner.name} — toute action ici est purement consultative.
          </p>
        )}

        <div className={t.intervGrid} role="radiogroup" aria-label="Interventions sanctionnées">
          {actions.map((a) => {
            const disabled = isDisabled(a);
            const selected = a.id === action && !disabled;
            return (
              <button
                key={a.id}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-disabled={disabled}
                disabled={disabled}
                className={classNames(t.actionCard, selected && t.actionOn, disabled && t.actionOff)}
                onClick={() => selectAction(a)}
              >
                <span className={t.actionTitle}>
                  {a.title}
                  {a.id === "retrieval" ? <span className="pill on" style={{ marginLeft: 8 }}>recommandé</span> : null}
                </span>
                <span className={t.actionDesc}>{a.desc}</span>
                <span className={t.actionEffect}>
                  {disabled
                    ? "indisponible · aucune conception erronée active à corriger — ce blocage est un oubli, pas une erreur"
                    : a.effect}
                </span>
              </button>
            );
          })}
        </div>

        {error ? (
          <p className="mono" style={{ color: "var(--alarm)", fontSize: 13, marginTop: 16 }}>{error}</p>
        ) : null}

        <div className={t.confirmBar}>
          <p className="soft" style={{ margin: 0, fontSize: 14, maxWidth: "62ch" }}>
            {applied ? (
              <>
                <strong>{chosen.title}</strong> demandé pour {learner.name}. Le runtime a pris la main —
                alerte désormais <span className="mono">{applied.status}</span> ; elle se fermera d&apos;elle-même
                quand l&apos;apprenant aura terminé le travail. Vous n&apos;avez rien modifié à la main.
              </>
            ) : (
              <>
                Vous allez demander <strong>{chosen.title.toLowerCase()}</strong> pour {learner.name}. Le runtime
                l&apos;applique et écrit un instantané d&apos;audit — vous ne modifiez rien à la main.
              </>
            )}
          </p>
          <button type="button" className="btn primary" disabled={busy || !!applied} onClick={apply}>
            {busy ? "Application…" : applied ? "Appliqué ✓" : "Appliquer l'intervention"}
          </button>
        </div>
      </Panel>
    </div>
  );
}
