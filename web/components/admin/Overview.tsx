import { Panel } from "@/components/ui/Panel";
import { Metric } from "@/components/ui/Metric";
import { SourceMark } from "@/components/runtime/SourceMark";
import { Mark } from "@/components/Mark";
import { isInstructionOnly, pct } from "@/lib/runtime";
import type { ScopeRow } from "./types";
import a from "./admin.module.css";

// Tenant overview. The tenant default LLM config is read live; everything durable
// (mastery/reviews/alerts) is runtime-owned, not the admin's.
export function Overview({
  tenantName,
  tenantSlug,
  domainName,
  learnerCount,
  cohortName,
  programName,
  matrix,
  avgMastery,
  openAlerts,
  highAlerts,
  onGoto,
}: {
  tenantName: string;
  tenantSlug: string;
  domainName: string;
  learnerCount: number;
  cohortName: string;
  programName: string;
  matrix: ScopeRow[];
  avgMastery: number | null;
  openAlerts: number;
  highAlerts: number;
  onGoto: () => void;
}) {
  const tenantCfg = matrix.find((m) => m.tier === "tenant")?.config ?? null;
  const provider = tenantCfg?.provider ?? "—";
  const model = tenantCfg?.model ?? "—";
  const instr = isInstructionOnly(tenantCfg);

  return (
    <div className="col" style={{ gap: 22 }}>
      <div className="row" style={{ gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <Mark source="runtime">runtime owned state</Mark>
        <span className="mono quiet" style={{ fontSize: 11 }}>tenant overview · {tenantSlug}</span>
      </div>

      <div className={a.tiles}>
        <Metric label="Programs" value="1" hint={programName} />
        <Metric label="Cohorts" value="1" hint={cohortName} />
        <Metric label="Learners" value={String(learnerCount)} hint="active memberships" />
        <Metric
          label="Cohort avg mastery"
          value={avgMastery != null ? pct(avgMastery) : "—"}
          tone="accent"
          hint="runtime · BKT aggregate"
        />
        <Metric
          label="Open alerts"
          value={String(openAlerts)}
          tone={openAlerts > 0 ? "amber" : "ink"}
          hint={highAlerts > 0 ? `${highAlerts} high · runtime raised` : "runtime raised"}
        />
      </div>

      <Panel
        kicker="Tenant facts"
        title="At a glance"
        aside={<span className="mono quiet" style={{ fontSize: 11 }}>GET /v1/tenants/{tenantSlug}</span>}
      >
        <dl className={a.kv}>
          <dt className="quiet">tenant</dt>
          <dd style={{ margin: 0 }}>
            <strong style={{ color: "var(--accent)" }}>{tenantName}</strong> · slug{" "}
            <span className="mono">{tenantSlug}</span>
          </dd>
          <dt className="quiet">domain</dt>
          <dd style={{ margin: 0 }}>{domainName}</dd>
          <dt className="quiet">llm default</dt>
          <dd style={{ margin: 0 }}>
            <SourceMark
              source={instr ? "fallbk" : "llm"}
              detail={`${provider}/${model}${tenantCfg?.temperature != null ? ` · temp ${tenantCfg.temperature}` : ""}${tenantCfg?.max_tokens != null ? ` · ${tenantCfg.max_tokens} tok` : ""}`}
            />
          </dd>
          <dt className="quiet">your role</dt>
          <dd style={{ margin: 0 }}>
            <span className={`${a.rolePill} ${a.roleAdmin}`}>tenant_admin</span> &nbsp;derived from membership, not requested
          </dd>
          <dt className="quiet">token</dt>
          <dd style={{ margin: 0 }}>
            bearer JWT · RS256 · 24h cap · scope <span className="mono">tenant:{tenantSlug}</span>
          </dd>
        </dl>
      </Panel>

      <div className={a.note}>
        <span className={a.noteIco} aria-hidden="true">◷</span>
        <span>
          The pedagogical state machine is the <b>runtime&apos;s</b>, not yours. Mastery, reviews,
          misconceptions and alerts are computed and owned by the runtime. You shape identity, structure,
          the read-only domain DAG, and the{" "}
          <button type="button" className="btn ghost" style={{ padding: "2px 10px", fontSize: 12 }} onClick={onGoto}>
            LLM configuration matrix →
          </button>
        </span>
      </div>
    </div>
  );
}
