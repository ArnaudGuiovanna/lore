"use client";

import { useCallback, useId, useMemo, useState } from "react";
import { StreamReader } from "@/components/runtime/StreamReader";
import { CodeBlock } from "@/components/runtime/CodeBlock";
import { SourceMark } from "@/components/runtime/SourceMark";
import { Metric } from "@/components/ui/Metric";
import { Mark } from "@/components/Mark";
import { fmtPct } from "@/lib/format";
import type { LearnerState } from "@/lib/types";

export interface NowIntent {
  conceptId: string;
  conceptName: string;
  // The runtime's planned activity type for this concept (a hint from /state).
  activityType: string;
  rationale: string;
  difficultyTarget: number;
  misconception?: string;
}

// The runtime-resolved activity returned by /api/activities/next at "Begin".
interface PlannedActivity {
  activityId: string;
  activityType: string;
  rationale: string;
  difficultyTarget: number;
  misconception?: string;
}

// The runtime-authored fallback scaffold. Because the seed resolves to
// instruction_only, this numbered scaffold (amber, instruction-only) is the
// default content path — faithful to the learner's resolved tutor config.
function fallbackScaffold(intent: NowIntent, misconception?: string): { prose: string; code: string } {
  const c = intent.conceptName.toLowerCase();
  const prose =
    `Ceci est une tâche de remédiation rédigée par le runtime sur ${c}. Aucun modèle ne l'a générée — le runtime ` +
    `l'a composée à partir de votre jeu d'instructions, car votre tuteur est résolu en instruction seule. ` +
    `Procédez dans l'ordre :\n\n` +
    `1. Lisez le handler ci-dessous et nommez, en une phrase, ce qu'il ne garantit pas` +
    (misconception ? ` (votre dernière tentative montrait : ${misconception}).` : `.`) +
    `\n2. Repérez la ligne exacte où un échec laisse l'état persistant incohérent.` +
    `\n3. Réécrivez-le pour que le travail soit entièrement validé ou entièrement annulé.` +
    `\n4. Énoncez l'unique invariant que votre correction garantit désormais.`;
  const code =
    `func (s *Store) transfer(ctx context.Context, from, to ID, amount int64) error {\n` +
    `    if err := s.debit(ctx, from, amount); err != nil {\n` +
    `        return err\n` +
    `    }\n` +
    `    // ${c} : que devient le débit si cet appel suivant échoue ?\n` +
    `    return s.credit(ctx, to, amount)\n` +
    `}`;
  return { prose, code };
}

type Phase = "intent" | "reading" | "evidence" | "delta";

export function NowWorkbench({
  learnerId,
  domainId,
  intent,
  initialState,
}: {
  learnerId: string;
  domainId: string;
  intent: NowIntent;
  initialState?: LearnerState;
}) {
  const [phase, setPhase] = useState<Phase>("intent");
  const [before] = useState<LearnerState | undefined>(initialState);
  const [after, setAfter] = useState<LearnerState | undefined>(undefined);
  const [planned, setPlanned] = useState<PlannedActivity | null>(null);
  const [success, setSuccess] = useState(true);
  const [score, setScore] = useState(70);
  const [planning, setPlanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneReading, setDoneReading] = useState(false);
  const formId = useId();

  const misconception = planned?.misconception ?? intent.misconception;
  const scaffold = useMemo(() => fallbackScaffold(intent, misconception), [intent, misconception]);

  // Begin: ask the runtime to plan the next real activity. The runtime owns
  // progression; we only relay its decision and use its real activity_id.
  const begin = useCallback(async () => {
    setPlanning(true);
    setError(null);
    try {
      const res = await fetch("/api/activities/next", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ learnerId, domainId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as Record<string, unknown>;
      const activity = (data.activity ?? {}) as Record<string, unknown>;
      const instruction = ((data.tutor_instruction ?? data.instruction) ?? {}) as Record<string, unknown>;
      const ctx = (instruction.context ?? {}) as Record<string, unknown>;
      const mc = ctx.misconception as Record<string, unknown> | undefined;
      setPlanned({
        activityId: String(activity.id ?? ""),
        activityType: String(activity.activity_type ?? intent.activityType),
        rationale: String(activity.audit_rationale ?? intent.rationale),
        difficultyTarget:
          typeof activity.difficulty_target === "number"
            ? (activity.difficulty_target as number)
            : intent.difficultyTarget,
        misconception:
          (typeof mc?.description === "string" && mc.description) || intent.misconception || undefined,
      });
      setPhase("reading");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Impossible de planifier votre prochaine étape.");
    } finally {
      setPlanning(false);
    }
  }, [learnerId, domainId, intent]);

  const submit = useCallback(async () => {
    if (!planned?.activityId) {
      setError("Aucune activité planifiée à laquelle rattacher cet enregistrement.");
      return;
    }
    setBusy(true);
    setError(null);
    const idempotencyKey = `now-${learnerId}-${planned.activityId}-${Date.now()}`;
    try {
      const res = await fetch("/api/interactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          learner_id: learnerId,
          activity_id: planned.activityId,
          success,
          score: score / 100,
          error_type: success ? undefined : misconception ?? "unspecified",
          idempotencyKey,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const stateRes = await fetch(
        `/api/learner/state?learnerId=${encodeURIComponent(learnerId)}&conceptId=${encodeURIComponent(intent.conceptId)}`
      );
      if (stateRes.ok) {
        const next = (await stateRes.json()) as { state?: LearnerState };
        setAfter(next.state ?? undefined);
      }
      setPhase("delta");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Impossible d'enregistrer votre preuve.");
    } finally {
      setBusy(false);
    }
  }, [learnerId, planned, intent.conceptId, success, score, misconception]);

  // ---- INTENT (the amorce: one runtime-decided intention) -------------------
  if (phase === "intent") {
    return (
      <section className="col" style={{ gap: 22 }}>
        <div className="col" style={{ gap: 10 }}>
          <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
            <Mark source="runtime" />
            <span className="mono quiet" style={{ fontSize: 11 }}>
              concept {intent.conceptId} · {intent.activityType.toLowerCase().replace(/_/g, " ")}
            </span>
          </div>
          <h1 className="standfirst">Corrigez {intent.conceptName.toLowerCase()} avant d&apos;avancer.</h1>
          <p className="soft" style={{ maxWidth: "62ch", fontSize: 15, lineHeight: 1.6 }}>
            {intent.rationale}
          </p>
        </div>
        <div
          className="row"
          style={{ gap: "20px 28px", flexWrap: "wrap", rowGap: 16 }}
        >
          <Metric label="maîtrise" value={fmtPct(before?.mastery)} />
          <Metric label="rétention" value={fmtPct(before?.retention)} tone="amber" />
          <Metric label="difficulté visée" value={intent.difficultyTarget.toFixed(2)} />
          {intent.misconception ? (
            <span style={{ maxWidth: "100%", overflowWrap: "anywhere" }}>
              <Metric label="conception erronée" value={intent.misconception} tone="alarm" />
            </span>
          ) : null}
        </div>
        {error ? (
          <p className="mono" style={{ color: "var(--alarm)", fontSize: 13 }}>
            {error}
          </p>
        ) : null}
        <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
          <button type="button" className="btn primary" onClick={begin} disabled={planning}>
            {planning ? "Interrogation du runtime…" : "⏎ Commencer"}
          </button>
          <span className="mono quiet" style={{ fontSize: 11 }} data-testid="now-intent-line">
            le runtime planifie cette étape · le LLM ne fait que remplir le contenu
          </span>
        </div>
      </section>
    );
  }

  // ---- READING (full-column takeover that streams the practice) -------------
  if (phase === "reading") {
    return (
      <section className="col" style={{ gap: 20 }}>
        <div className="spread" style={{ flexWrap: "wrap", gap: 10 }}>
          <SourceMark source="fallbk" detail="rédigé par le runtime · instruction seule" />
          <button type="button" className="btn ghost" onClick={() => setPhase("intent")}>
            ← retour
          </button>
        </div>
        {planned?.rationale ? (
          <p className="mono quiet" style={{ fontSize: 11 }}>
            justification du runtime · {planned.rationale}
          </p>
        ) : null}
        <div className="prose" style={{ whiteSpace: "pre-wrap", fontSize: 18 }}>
          <StreamReader text={scaffold.prose} onDone={() => setDoneReading(true)} />
        </div>
        <CodeBlock code={scaffold.code} language="go" />
        <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn primary"
            onClick={() => setPhase("evidence")}
            disabled={!doneReading}
          >
            J&apos;ai terminé →
          </button>
          {!doneReading ? (
            <span className="mono quiet" style={{ fontSize: 11 }}>
              dévoilement au rythme de lecture…
            </span>
          ) : null}
        </div>
      </section>
    );
  }

  // ---- EVIDENCE (form -> POST /api/interactions) ----------------------------
  if (phase === "evidence") {
    return (
      <section className="col" style={{ gap: 18, maxWidth: 560 }}>
        <div className="col" style={{ gap: 6 }}>
          <span className="kicker">Votre preuve</span>
          <p className="soft" style={{ fontSize: 14, lineHeight: 1.6 }}>
            Dites au runtime ce qui s&apos;est passé. C&apos;est lui — pas le contenu — qui décide
            de la maîtrise, de la rétention et de votre prochaine étape.
          </p>
        </div>

        <fieldset
          className="col"
          style={{ gap: 10, border: "1px solid var(--line)", borderRadius: 12, padding: 16 }}
        >
          <legend className="kicker" style={{ padding: "0 6px" }}>
            résultat
          </legend>
          <label className="row" style={{ gap: 10, cursor: "pointer" }}>
            <input
              type="radio"
              name={`${formId}-success`}
              checked={success}
              onChange={() => setSuccess(true)}
            />
            <span style={{ fontSize: 15 }}>J&apos;ai rendu le traitement atomique — il valide ou annule entièrement.</span>
          </label>
          <label className="row" style={{ gap: 10, cursor: "pointer" }}>
            <input
              type="radio"
              name={`${formId}-success`}
              checked={!success}
              onChange={() => setSuccess(false)}
            />
            <span style={{ fontSize: 15 }}>Je suis encore bloqué — le chemin d&apos;échec n&apos;est pas clair.</span>
          </label>
        </fieldset>

        <label className="col" style={{ gap: 8 }}>
          <span className="kicker">confiance dans cette réponse · {score}%</span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={score}
            onChange={(e) => setScore(Number(e.target.value))}
            aria-label="niveau de confiance"
          />
        </label>

        {error ? (
          <p className="mono" style={{ color: "var(--alarm)", fontSize: 13 }}>
            {error}
          </p>
        ) : null}

        <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
          <button type="button" className="btn primary" onClick={submit} disabled={busy}>
            {busy ? "Enregistrement…" : "Enregistrer la preuve"}
          </button>
          <button type="button" className="btn ghost" onClick={() => setPhase("reading")} disabled={busy}>
            ← relire
          </button>
        </div>
      </section>
    );
  }

  // ---- DELTA (in-column state delta from the refreshed /state) --------------
  const deltaRows: { label: string; from?: number; to?: number; pct?: boolean }[] = [
    { label: "maîtrise", from: before?.mastery, to: after?.mastery, pct: true },
    { label: "rétention", from: before?.retention, to: after?.retention, pct: true },
    { label: "confiance", from: before?.confidence, to: after?.confidence, pct: true },
    { label: "stabilité", from: before?.stability, to: after?.stability },
    { label: "répétitions", from: before?.reps, to: after?.reps },
    { label: "oublis", from: before?.lapses, to: after?.lapses },
  ];
  return (
    <section className="col" style={{ gap: 18 }}>
      <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
        <Mark source="runtime" />
        <span className="mono quiet" style={{ fontSize: 11 }}>
          écart d&apos;état · le runtime vous a réévalué
        </span>
      </div>
      <h2 style={{ fontSize: 22 }}>Ce qui a changé pour {intent.conceptName.toLowerCase()}.</h2>
      <div className="col" style={{ gap: 2 }}>
        {deltaRows.map((r) => {
          const fmt = (v?: number) =>
            v === undefined ? "—" : r.pct ? fmtPct(v) : Number.isInteger(v) ? String(v) : v.toFixed(2);
          const moved = r.from !== undefined && r.to !== undefined && r.from !== r.to;
          const up = (r.to ?? 0) > (r.from ?? 0);
          return (
            <div
              key={r.label}
              className="spread"
              style={{ padding: "10px 0", borderBottom: "1px solid var(--line)", gap: 16 }}
            >
              <span className="kicker">{r.label}</span>
              <span className="mono" style={{ fontSize: 14 }}>
                {fmt(r.from)} <span className="quiet">→</span>{" "}
                <span
                  style={{
                    color: moved ? (up ? "var(--accent)" : "var(--alarm)") : "var(--ink)",
                    fontWeight: moved ? 600 : 400,
                  }}
                >
                  {fmt(r.to)}
                </span>
              </span>
            </div>
          );
        })}
      </div>
      {after?.card_state ? (
        <p className="soft" style={{ fontSize: 14 }}>
          État de la carte : <span className="mono">{after.card_state}</span>
          {misconception ? (
            <>
              {" "}
              · conception erronée <span className="mono">{misconception}</span> toujours suivie — le
              runtime maintient ce concept verrouillé tant que la correction ne tient pas.
            </>
          ) : null}
        </p>
      ) : null}
      <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn"
          onClick={() => {
            setPlanned(null);
            setDoneReading(false);
            setAfter(undefined);
            setPhase("intent");
          }}
        >
          ↺ prochaine tentative
        </button>
        <span className="mono quiet" style={{ fontSize: 11 }}>
          la progression relève du runtime — jamais du contenu
        </span>
      </div>
    </section>
  );
}
