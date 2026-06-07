"use client";

import { useMemo, useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { ReviewState, type FieldDiff } from "@/components/ui/ReviewState";
import { Mark } from "@/components/Mark";
import { classNames } from "@/lib/format";
import { isInstructionOnly } from "@/lib/runtime";
import type { LLMConfiguration } from "@/lib/types";
import type { OutboxEvent, ScopeRow, ScopeTier } from "./types";
import a from "./admin.module.css";

const TIER_CLASS: Record<ScopeTier, string> = {
  tenant: a.t1,
  program: a.t2,
  cohort: a.t3,
  learner: a.t4,
};

interface Draft {
  provider: string;
  model: string;
  temperature: number;
  max_tokens: number;
}

function defaultsFor(row: ScopeRow, tenantCfg: LLMConfiguration | null): Draft {
  const c = row.config ?? tenantCfg;
  return {
    provider: c?.provider ?? "anthropic",
    model: c?.model ?? "claude",
    temperature: c?.temperature ?? 0.2,
    max_tokens: c?.max_tokens ?? 512,
  };
}

// Resolution chain (most-specific-first) computed from the live matrix for one learner.
function resolveChain(matrix: ScopeRow[], learnerName: string) {
  const learner = matrix.find((m) => m.tier === "learner" && m.label === learnerName);
  const cohort = matrix.find((m) => m.tier === "cohort");
  const program = matrix.find((m) => m.tier === "program");
  const tenant = matrix.find((m) => m.tier === "tenant");
  const order = [
    { tier: "learner", label: `learner · ${learnerName}`, set: !!learner?.config, cfg: learner?.config },
    { tier: "cohort", label: `cohort · ${cohort?.label}`, set: !!cohort?.config, cfg: cohort?.config },
    { tier: "program", label: `program · ${program?.label}`, set: !!program?.config, cfg: program?.config },
    { tier: "tenant", label: `tenant`, set: !!tenant?.config, cfg: tenant?.config },
  ];
  const winIdx = order.findIndex((o) => o.set);
  return { order, winIdx: winIdx < 0 ? order.length - 1 : winIdx };
}

export function LlmMatrix({
  tenantSlug,
  matrix,
  learners,
  onApplied,
}: {
  tenantSlug: string;
  matrix: ScopeRow[];
  learners: string[];
  onApplied: (row: ScopeRow, event: OutboxEvent) => void;
}) {
  const tenantCfg = matrix.find((m) => m.tier === "tenant")?.config ?? null;
  const editableKeys = matrix.filter((m) => m.editable && m.tier !== "tenant" && m.tier !== "program");
  const [editing, setEditing] = useState<ScopeRow | null>(null);
  const [draft, setDraft] = useState<Draft>(() => defaultsFor(editableKeys[0] ?? matrix[0], tenantCfg));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [who, setWho] = useState<string>(learners[0] ?? "");

  function openEditor(row: ScopeRow) {
    setEditing(row);
    setDraft(defaultsFor(row, tenantCfg));
    setErr(null);
  }

  const chain = useMemo(() => resolveChain(matrix, who), [matrix, who]);

  const instr = draft.provider === "instruction_only";
  const diffs: FieldDiff[] = editing
    ? [
        { field: "provider", before: editing?.config?.provider ?? "↑ inherited", after: draft.provider },
        { field: "model", before: editing?.config?.model ?? "↑ inherited", after: instr ? "—" : draft.model },
        {
          field: "temperature",
          before: editing?.config?.temperature ?? "↑ inherited",
          after: instr ? "—" : String(draft.temperature),
        },
        {
          field: "max_tokens",
          before: editing?.config?.max_tokens ?? "↑ inherited",
          after: instr ? "—" : String(draft.max_tokens),
        },
      ]
    : [];
  // Dangerous-change discipline: a write is only allowed when at least one field
  // actually differs from the scope's current explicit config. A no-op write is
  // refused so the audited LLM-config change always means something changed.
  const hasChange = diffs.some((d) => String(d.before) !== String(d.after));

  async function apply() {
    if (!editing) return;
    if (!hasChange) {
      setErr("Aucun champ ne diffère de la config actuelle — rien à appliquer.");
      return;
    }
    setBusy(true);
    setErr(null);
    const body: Record<string, unknown> = {
      scope_type: editing.tier,
      scope_id: editing.scopeId || undefined,
      provider: draft.provider,
      model: instr ? `${editing.tier}-runtime` : draft.model,
    };
    if (!instr) {
      body.temperature = draft.temperature;
      body.max_tokens = draft.max_tokens;
    }
    try {
      const res = await fetch("/api/llm-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as LLMConfiguration & { error?: string };
      if (!res.ok) {
        setErr(data.error || `HTTP ${res.status}`);
        setBusy(false);
        return;
      }
      const applied: ScopeRow = { ...editing, config: data };
      const event: OutboxEvent = {
        id: `local-${data.scope_type}-${data.scope_id ?? "tenant"}-${Date.now()}`,
        eventType: "LlmConfigurationUpdated",
        aggregateType: "llm_configuration",
        aggregateId: data.scope_id || tenantSlug,
        occurredAt: new Date().toISOString(),
        published: false,
        payload: { scope_type: data.scope_type, provider: data.provider, model: data.model },
        annotation: "vient d'être appliqué — validé dans la même transaction que l'écriture",
      };
      setBusy(false);
      setEditing(null);
      onApplied(applied, event);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "erreur réseau");
      setBusy(false);
    }
  }

  return (
    <div className="col" style={{ gap: 22 }}>
      <div className="row" style={{ gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <Mark source="llm">config de génération LLM</Mark>
        <span className="mono quiet" style={{ fontSize: 11 }}>résolution du plus spécifique au plus général</span>
      </div>
      <p className="soft" style={{ maxWidth: "62ch", margin: 0 }}>
        Le LLM ne génère que le contenu destiné à l&apos;apprenant à partir d&apos;une instruction rédigée par le
        runtime — il ne pilote jamais la progression. C&apos;est <em>cela</em> que vous configurez : fournisseur,
        modèle et limites, à quatre niveaux de périmètre. Le runtime résout la config effective <em>du plus
        spécifique au plus général</em> (apprenant › groupe › programme › tenant).
      </p>

      <Panel
        kicker="Matrice de configuration"
        title="Quel modèle parle, et où"
        aside={<span className="mono quiet" style={{ fontSize: 11 }}>GET /v1/tenants/{tenantSlug}/llm-configurations</span>}
      >
        <div className={a.matrixWrap}>
          <table style={{ width: "100%", minWidth: 680, borderCollapse: "collapse", fontFamily: "var(--mono)", fontSize: 13 }}>
            <thead>
              <tr>
                {["Périmètre", "Fournisseur / modèle", "Temp", "Max tokens", "Défini au niveau", ""].map((h) => (
                  <th
                    key={h}
                    style={{
                      textAlign: "left",
                      padding: "11px 12px",
                      borderBottom: "1px solid var(--line)",
                      fontSize: 9.5,
                      letterSpacing: "0.1em",
                      textTransform: "uppercase",
                      color: "var(--quiet)",
                      fontWeight: 500,
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrix.map((row) => {
                const c = row.config;
                const set = !!c;
                const isInstr = isInstructionOnly(c);
                return (
                  <tr key={`${row.tier}-${row.scopeId}`} style={{ borderBottom: "1px solid var(--line-2)" }}>
                    <td style={{ padding: "11px 12px" }}>
                      <span className={a.scopeCell}>
                        <span className={classNames(a.scopeTier, TIER_CLASS[row.tier])}>{row.tier}</span>
                        <span style={{ color: "var(--ink)" }}>{row.label}</span>
                        {row.hint ? <span className="quiet" style={{ fontSize: 10 }}>{row.hint}</span> : null}
                      </span>
                    </td>
                    <td style={{ padding: "11px 12px" }}>
                      {set ? (
                        <span className={isInstr ? a.providerInstr : ""}>
                          {c!.provider}
                          {c!.model && !isInstr ? `/${c!.model}` : ""}
                        </span>
                      ) : (
                        <span className={a.inherit}>↑ hérite {row.tier === "tenant" ? "—" : "du parent"}</span>
                      )}
                    </td>
                    <td style={{ padding: "11px 12px" }} className={set ? "" : a.inherit}>
                      {set && c!.temperature != null ? c!.temperature : "—"}
                    </td>
                    <td style={{ padding: "11px 12px" }} className={set ? "" : a.inherit}>
                      {set && c!.max_tokens != null ? c!.max_tokens : "—"}
                    </td>
                    <td style={{ padding: "11px 12px" }} className="quiet">
                      {row.tier === "tenant" ? "défaut du tenant" : set ? "remplacement" : "non remplacé"}
                    </td>
                    <td style={{ padding: "11px 12px", textAlign: "right" }}>
                      {row.editable && row.tier !== "tenant" ? (
                        <button
                          type="button"
                          className={classNames(a.editBtn, editing?.tier === row.tier && editing?.scopeId === row.scopeId && a.editBtnOn)}
                          onClick={() => openEditor(row)}
                        >
                          modifier ⤸
                        </button>
                      ) : (
                        <span className="quiet" style={{ fontSize: 9.5 }}>— racine héritée —</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* resolution explainer (most-specific-first), computed from live matrix */}
        {learners.length ? (
          <div className={a.resolveBox}>
            <p className="kicker" style={{ marginTop: 0 }}>
              Résolution · du plus spécifique au plus général (apprenant › groupe › programme › tenant)
            </p>
            <div className={a.resolveToggle} role="group" aria-label="Résoudre la config effective pour">
              {learners.map((l) => (
                <button
                  key={l}
                  type="button"
                  className={classNames(a.rtBtn, who === l && a.rtOn)}
                  onClick={() => setWho(l)}
                >
                  pour {l}
                </button>
              ))}
            </div>
            <div className={a.resolveChain}>
              {chain.order.map((stg, i) => (
                <span key={stg.tier} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <span className={classNames(a.rstage, i === chain.winIdx && a.rstageWin)}>
                    <span className={a.ord}>{i + 1}</span>
                    {stg.label} · {stg.set ? "défini" : "—"}
                  </span>
                  {i < chain.order.length - 1 ? <span className={a.ra}>→</span> : null}
                </span>
              ))}
            </div>
            <p className="soft" style={{ margin: 0, fontSize: 15 }}>
              {(() => {
                const win = chain.order[chain.winIdx];
                const cfg = win?.cfg;
                if (cfg && isInstructionOnly(cfg)) {
                  return (
                    <>
                      La correspondance la plus spécifique est le périmètre <b>{win.tier}</b> → config effective ={" "}
                      <strong className="mono" style={{ color: "var(--amber)" }}>instruction_only</strong>. Le
                      modèle tuteur est désactivé ici ; le runtime rédige les supports.
                    </>
                  );
                }
                return (
                  <>
                    La première config trouvée est le périmètre <b>{win?.tier}</b> → config effective ={" "}
                    <strong className="mono" style={{ color: "var(--accent)" }}>
                      {cfg ? `${cfg.provider}/${cfg.model}` : "défaut du tenant"}
                    </strong>
                    . Cet apprenant reçoit un tutorat généré.
                  </>
                );
              })()}
            </p>
          </div>
        ) : null}
      </Panel>

      {editing ? (
        <Panel
          kicker="Config LLM · édition de périmètre"
          title={`Modifier le périmètre ${editing.tier}`}
          aside={<span className="mono quiet" style={{ fontSize: 11 }}>PUT /v1/tenants/{tenantSlug}/llm-configurations</span>}
        >
          <div className="row" style={{ gap: 18, rowGap: 6, marginBottom: 14, fontFamily: "var(--mono)", fontSize: 12, flexWrap: "wrap" }}>
            <span className="quiet">scope_type</span>
            <strong style={{ color: "var(--accent)" }}>{editing.tier}</strong>
            <span className="quiet">scope_id</span>
            <span className="mono" style={{ overflowWrap: "anywhere", minWidth: 0 }}>{editing.scopeId || "(tenant)"}</span>
          </div>

          <div className={a.editorGrid}>
            <div>
              <label className={a.fieldLabel} htmlFor="adm-provider">Fournisseur</label>
              <select
                id="adm-provider"
                className={a.select}
                value={draft.provider}
                onChange={(e) => {
                  const provider = e.target.value;
                  setDraft((d) => ({
                    ...d,
                    provider,
                    // a *-runtime placeholder is not a real LLM model; pick a sane default
                    model: provider === "instruction_only" || !d.model.endsWith("-runtime")
                      ? d.model
                      : provider === "ollama"
                        ? "gemma4"
                        : "claude",
                  }));
                }}
              >
                <option value="anthropic">anthropic</option>
                <option value="ollama">ollama</option>
                <option value="instruction_only">instruction_only (aucun LLM)</option>
              </select>
              <p className={a.hint}>instruction_only = le runtime rédige les supports, aucun modèle appelé</p>
            </div>
            <div>
              <label className={a.fieldLabel} htmlFor="adm-model">Modèle</label>
              <select
                id="adm-model"
                className={a.select}
                value={draft.model}
                disabled={instr}
                onChange={(e) => setDraft((d) => ({ ...d, model: e.target.value }))}
              >
                <option value="claude">claude</option>
                <option value="claude-haiku">claude-haiku</option>
                <option value="gemma4">gemma4</option>
              </select>
              <p className={a.hint}>désactivé quand le fournisseur est instruction_only</p>
            </div>
            <div>
              <label className={a.fieldLabel} htmlFor="adm-temp">
                Température · <span className="mono" style={{ color: "var(--accent)" }}>{draft.temperature.toFixed(1)}</span>
              </label>
              <div className={a.rangeRow}>
                <input
                  id="adm-temp"
                  type="range"
                  min={0}
                  max={1}
                  step={0.1}
                  value={draft.temperature}
                  disabled={instr}
                  onChange={(e) => setDraft((d) => ({ ...d, temperature: Number(e.target.value) }))}
                />
                <span className={a.rangeVal}>{draft.temperature.toFixed(1)}</span>
              </div>
              <p className={a.hint}>plus bas = génération plus déterministe</p>
            </div>
            <div>
              <label className={a.fieldLabel} htmlFor="adm-max">Max tokens</label>
              <input
                id="adm-max"
                className={a.input}
                type="number"
                min={64}
                max={2048}
                step={64}
                value={draft.max_tokens}
                disabled={instr}
                onChange={(e) => setDraft((d) => ({ ...d, max_tokens: Number(e.target.value) }))}
              />
              <p className={a.hint}>plafond par génération</p>
            </div>
          </div>

          <div style={{ borderTop: "1px dashed var(--line)", paddingTop: 20, marginTop: 4 }}>
            <p className="kicker" style={{ color: "var(--amber)", marginTop: 0 }}>
              Revue · discipline des changements sensibles
            </p>
            <p className="mono quiet" style={{ fontSize: 11, marginTop: 0, marginBottom: 14 }}>
              L&apos;application est bloquée tant que vous n&apos;avez pas coché la case et qu&apos;au moins un champ ne diffère pas.
            </p>
            <ReviewState
              diffs={diffs}
              impact={
                <>
                  Ceci écrit une config explicite à <b>{editing.tier}:{editing.scopeId || "(tenant)"}</b> et
                  change la génération pour les apprenants concernés. La résolution reste du plus spécifique au plus
                  général — un périmètre plus spécifique l&apos;emporte toujours. C&apos;est un changement détenu par
                  le runtime et audité.
                </>
              }
              acknowledgement={
                <>
                  Je comprends que cela écrit une config explicite à{" "}
                  <strong className="mono">{editing.tier}:{editing.scopeId || "(tenant)"}</strong> et change la
                  génération pour les apprenants concernés.
                </>
              }
              confirmLabel="Appliquer la configuration"
              cancelLabel="Annuler"
              busy={busy}
              error={err}
              onConfirm={apply}
              onCancel={() => setEditing(null)}
            />
          </div>
        </Panel>
      ) : null}

      <div className={a.note}>
        <span className={a.noteIco} aria-hidden="true">⤸</span>
        <span>
          Le runtime vérifie d&apos;abord <b>l&apos;apprenant</b>, puis le <b>groupe</b>, puis le <b>programme</b>, puis le{" "}
          <b>tenant</b> — la première config trouvée l&apos;emporte. Modifier un périmètre ouvre une revue (diff de
          champ en direct, rayon d&apos;impact, confirmation explicite) avant toute application.
        </span>
      </div>
    </div>
  );
}
