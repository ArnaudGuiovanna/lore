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
        <Mark source="runtime">état détenu par le runtime</Mark>
        <span className="mono quiet" style={{ fontSize: 11 }}>vue d&apos;ensemble du tenant · {tenantSlug}</span>
      </div>

      <div className={a.tiles}>
        <Metric label="Programmes" value="1" hint={programName} />
        <Metric label="Groupes" value="1" hint={cohortName} />
        <Metric label="Apprenants" value={String(learnerCount)} hint="appartenances actives" />
        <Metric
          label="Maîtrise moy. du groupe"
          value={avgMastery != null ? pct(avgMastery) : "—"}
          tone="accent"
          hint="runtime · agrégat BKT"
        />
        <Metric
          label="Alertes ouvertes"
          value={String(openAlerts)}
          tone={openAlerts > 0 ? "amber" : "ink"}
          hint={highAlerts > 0 ? `${highAlerts} élevée(s) · émises par le runtime` : "émises par le runtime"}
        />
      </div>

      <Panel
        kicker="Faits du tenant"
        title="En un coup d'œil"
        aside={<span className="mono quiet" style={{ fontSize: 11 }}>GET /v1/tenants/{tenantSlug}</span>}
      >
        <dl className={a.kv}>
          <dt className="quiet">tenant</dt>
          <dd style={{ margin: 0 }}>
            <strong style={{ color: "var(--accent)" }}>{tenantName}</strong> · slug{" "}
            <span className="mono">{tenantSlug}</span>
          </dd>
          <dt className="quiet">domaine</dt>
          <dd style={{ margin: 0 }}>{domainName}</dd>
          <dt className="quiet">llm par défaut</dt>
          <dd style={{ margin: 0 }}>
            <SourceMark
              source={instr ? "fallbk" : "llm"}
              detail={`${provider}/${model}${tenantCfg?.temperature != null ? ` · temp ${tenantCfg.temperature}` : ""}${tenantCfg?.max_tokens != null ? ` · ${tenantCfg.max_tokens} tok` : ""}`}
            />
          </dd>
          <dt className="quiet">votre rôle</dt>
          <dd style={{ margin: 0 }}>
            <span className={`${a.rolePill} ${a.roleAdmin}`}>tenant_admin</span> &nbsp;issu de l&apos;appartenance, jamais demandé
          </dd>
          <dt className="quiet">jeton</dt>
          <dd style={{ margin: 0 }}>
            JWT porteur · RS256 · plafond 24 h · périmètre <span className="mono">tenant:{tenantSlug}</span>
          </dd>
        </dl>
      </Panel>

      <div className={a.note}>
        <span className={a.noteIco} aria-hidden="true">◷</span>
        <span>
          La machine d&apos;état pédagogique appartient au <b>runtime</b>, pas à vous. La maîtrise, les révisions,
          les conceptions erronées et les alertes sont calculées et détenues par le runtime. Vous façonnez
          l&apos;identité, la structure, le DAG de domaine en lecture seule, et la{" "}
          <button type="button" className="btn ghost" style={{ padding: "2px 10px", fontSize: 12 }} onClick={onGoto}>
            matrice de configuration LLM →
          </button>
        </span>
      </div>
    </div>
  );
}
