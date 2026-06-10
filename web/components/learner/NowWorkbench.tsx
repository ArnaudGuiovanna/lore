"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { StreamReader } from "@/components/runtime/StreamReader";
import { CodeBlock } from "@/components/runtime/CodeBlock";
import { SourceMark } from "@/components/runtime/SourceMark";
import { Metric } from "@/components/ui/Metric";
import { Mark } from "@/components/Mark";
import { fmtPct } from "@/lib/format";
import type { AssessmentAnswer, AssessmentItem, GeneratedContent, LearnerState } from "@/lib/types";

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
  content: WorkbenchContent;
  assessmentItems: AssessmentItem[];
}

type WorkbenchContent = {
  source: "llm" | "fallbk";
  text: string;
  code?: string;
  provider?: string;
  model?: string;
  generatedId?: string;
  persisted: boolean;
  reason?: string;
};

// The runtime-authored fallback scaffold. This is only used when the web/backend
// API did not return generated content. Backend instruction_only content is shown
// separately as persisted instruction-only content.
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function generatedContent(value: unknown): GeneratedContent | null {
  if (!isRecord(value)) return null;
  const content = stringField(value.content).trim();
  if (!content) return null;
  return {
    tenant_id: stringField(value.tenant_id),
    id: stringField(value.id),
    instruction_id: stringField(value.instruction_id),
    provider: stringField(value.provider),
    model: stringField(value.model),
    content,
    created_at: stringField(value.created_at),
  };
}

function assessmentItemsFrom(value: unknown): AssessmentItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((raw): AssessmentItem | null => {
      if (!isRecord(raw)) return null;
      const id = stringField(raw.id).trim();
      const prompt = stringField(raw.prompt).trim();
      if (!id || !prompt) return null;
      const choices = Array.isArray(raw.choices)
        ? raw.choices
            .map((choice): { id: string; label: string } | null => {
              if (!isRecord(choice)) return null;
              const choiceId = stringField(choice.id).trim();
              const label = stringField(choice.label).trim();
              return choiceId && label ? { id: choiceId, label } : null;
            })
            .filter((choice): choice is { id: string; label: string } => Boolean(choice))
        : [];
      return {
        id,
        kind: stringField(raw.kind) || "single_choice",
        concept_id: stringField(raw.concept_id) || undefined,
        prompt,
        choices,
        points: typeof raw.points === "number" ? raw.points : 1,
      };
    })
    .filter((item): item is AssessmentItem => Boolean(item));
}

function isInstructionOnlyProvider(provider?: string): boolean {
  const p = (provider || "").trim().toLowerCase();
  return p === "instruction_only" || p === "runtime";
}

function localInstructionOnlyContent(intent: NowIntent, misconception?: string, reason?: string): WorkbenchContent {
  const scaffold = fallbackScaffold(intent, misconception);
  return {
    source: "fallbk",
    text: scaffold.prose,
    code: scaffold.code,
    provider: "instruction_only",
    model: "local",
    persisted: false,
    reason,
  };
}

function workbenchContentFrom(
  value: unknown,
  intent: NowIntent,
  misconception?: string,
  generationError?: string
): WorkbenchContent {
  const generated = generatedContent(value);
  if (!generated) {
    return localInstructionOnlyContent(
      intent,
      misconception,
      generationError ? `génération indisponible: ${generationError}` : "aucun contenu généré retourné"
    );
  }
  const instructionOnly = isInstructionOnlyProvider(generated.provider);
  return {
    source: instructionOnly ? "fallbk" : "llm",
    text: generated.content,
    provider: generated.provider || (instructionOnly ? "instruction_only" : "backend"),
    model: generated.model,
    generatedId: generated.id,
    persisted: true,
  };
}

function contentDetail(content: WorkbenchContent): string {
  const origin = content.persisted ? "contenu persisté" : "fallback local";
  const provider = [content.provider, content.model].filter(Boolean).join("/");
  const bits = [provider, origin, content.generatedId ? `id ${content.generatedId}` : "", content.reason || ""].filter(Boolean);
  return bits.join(" · ");
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
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [planning, setPlanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneReading, setDoneReading] = useState(false);
  const formId = useId();

  const misconception = planned?.misconception ?? intent.misconception;

  // FOAD time honesty (B-07): while an activity is underway, pause the training
  // clock when the tab is hidden and resume it when the learner comes back.
  useEffect(() => {
    const activityId = planned?.activityId;
    if (!activityId || (phase !== "reading" && phase !== "evidence")) return;
    const onVisibility = () => {
      const endpoint = document.visibilityState === "hidden" ? "pause" : "resume";
      void fetch(`/api/activities/${encodeURIComponent(activityId)}/${endpoint}`, {
        method: "POST",
        keepalive: true,
      }).catch(() => {});
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [planned?.activityId, phase]);
  const localFallback = useMemo(
    () => localInstructionOnlyContent(intent, misconception, "activité planifiée sans contenu généré"),
    [intent, misconception]
  );

  // Begin: ask the runtime to plan the next real activity. The runtime owns
  // progression; we only relay its decision and use its real activity_id.
  const begin = useCallback(async () => {
    setPlanning(true);
    setError(null);
    setDoneReading(false);
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
      const misconception =
        (typeof mc?.description === "string" && mc.description) || intent.misconception || undefined;
      const generated = data.generated_content ?? data.generatedContent;
      const generationError = data.generated_content_error as Record<string, unknown> | undefined;
      const generationErrorText = generationError?.error ? String(generationError.error) : undefined;
      const assessmentItems = assessmentItemsFrom(ctx.assessment_items);
      setPlanned({
        activityId: String(activity.id ?? ""),
        activityType: String(activity.activity_type ?? intent.activityType),
        rationale: String(activity.audit_rationale ?? intent.rationale),
        difficultyTarget:
          typeof activity.difficulty_target === "number"
            ? (activity.difficulty_target as number)
            : intent.difficultyTarget,
        misconception,
        content: workbenchContentFrom(generated, intent, misconception, generationErrorText),
        assessmentItems,
      });
      setAnswers({});
      setPhase("reading");
      // Mark the start boundary for training-time tracking (B-07). Best-effort:
      // a failed start never blocks the learner from working.
      const startedId = String(activity.id ?? "");
      if (startedId) {
        void fetch(`/api/activities/${encodeURIComponent(startedId)}/start`, { method: "POST" }).catch(() => {});
      }
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
      const isAssessment = planned.activityType === "ASSESSMENT";
      const assessmentAnswers: AssessmentAnswer[] = planned.assessmentItems.map((item) => ({
        item_id: item.id,
        choice_id: answers[item.id],
      }));
      if (isAssessment && assessmentAnswers.length === 0) {
        setError("Aucun item corrigé n'a été fourni par le runtime pour cette évaluation.");
        setBusy(false);
        return;
      }
      if (isAssessment && assessmentAnswers.some((answer) => !answer.choice_id)) {
        setError("Répondez à chaque item corrigé avant d'enregistrer.");
        setBusy(false);
        return;
      }
      const res = await fetch(
        isAssessment ? `/api/assessments/${encodeURIComponent(planned.activityId)}/submit` : "/api/interactions",
        {
        method: "POST",
        headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            isAssessment
              ? {
                  learner_id: learnerId,
                  answers: assessmentAnswers,
                  success,
                  score: score / 100,
                  confidence: score / 100,
                  idempotencyKey,
                }
              : {
                  learner_id: learnerId,
                  activity_id: planned.activityId,
                  success,
                  score: score / 100,
                  error_type: success ? undefined : misconception ?? "unspecified",
                  idempotencyKey,
                }
          ),
        }
      );
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
  }, [learnerId, planned, answers, intent.conceptId, success, score, misconception]);

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
    const content = planned?.content ?? localFallback;
    return (
      <section className="col" style={{ gap: 20 }}>
        <div className="spread" style={{ flexWrap: "wrap", gap: 10 }}>
          <SourceMark source={content.source} detail={contentDetail(content)} />
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
          <StreamReader text={content.text} onDone={() => setDoneReading(true)} />
        </div>
        {content.code ? <CodeBlock code={content.code} language="go" /> : null}
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
    const isAssessment = planned?.activityType === "ASSESSMENT";
    const assessmentItems = planned?.assessmentItems ?? [];
    return (
      <section className="col" style={{ gap: 18, maxWidth: 560 }}>
        <div className="col" style={{ gap: 6 }}>
          <span className="kicker">{isAssessment ? "Évaluation corrigée" : "Votre preuve"}</span>
          <p className="soft" style={{ fontSize: 14, lineHeight: 1.6 }}>
            {isAssessment
              ? "Répondez aux items corrigés. Le runtime calcule le score à partir de vos réponses, puis met à jour la maîtrise."
              : "Dites au runtime ce qui s'est passé. C'est lui — pas le contenu — qui décide de la maîtrise, de la rétention et de votre prochaine étape."}
          </p>
        </div>

        {isAssessment ? (
          <div className="col" style={{ gap: 14 }}>
            {assessmentItems.map((item, index) => (
              <fieldset
                key={item.id}
                className="col"
                style={{ gap: 10, border: "1px solid var(--line)", borderRadius: 12, padding: 16 }}
              >
                <legend className="kicker" style={{ padding: "0 6px" }}>
                  item {index + 1}
                </legend>
                <p style={{ margin: 0, lineHeight: 1.5 }}>{item.prompt}</p>
                {(item.choices ?? []).map((choice) => (
                  <label key={choice.id} className="row" style={{ gap: 10, cursor: "pointer" }}>
                    <input
                      type="radio"
                      name={`${formId}-${item.id}`}
                      checked={answers[item.id] === choice.id}
                      onChange={() => setAnswers((prev) => ({ ...prev, [item.id]: choice.id }))}
                    />
                    <span style={{ fontSize: 15 }}>{choice.label}</span>
                  </label>
                ))}
              </fieldset>
            ))}
            {assessmentItems.length === 0 ? (
              <p className="mono" style={{ color: "var(--alarm)", fontSize: 13 }}>
                Aucun item corrigé n&apos;a été fourni par le runtime pour cette évaluation.
              </p>
            ) : null}
          </div>
        ) : null}

        <fieldset
          className="col"
          style={{ gap: 10, border: "1px solid var(--line)", borderRadius: 12, padding: 16 }}
        >
          <legend className="kicker" style={{ padding: "0 6px" }}>
            {isAssessment ? "ressenti apprenant" : "résultat"}
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
