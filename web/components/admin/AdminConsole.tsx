"use client";

import { useState } from "react";
import { classNames } from "@/lib/format";
import type {
  DomainGraphData,
  EnrollableLearner,
  ManagedProgram,
  MembershipRow,
  OutboxEvent,
  ProgramNode,
  RosterRow,
  ScopeRow,
} from "./types";
import { Overview } from "./Overview";
import { IdentityManager } from "./IdentityManager";
import { OrgManager } from "./OrgManager";
import { DomainGraph } from "./DomainGraph";
import { LlmMatrix } from "./LlmMatrix";
import { EventOutbox } from "./EventOutbox";
import a from "./admin.module.css";

type Section = "overview" | "identity" | "structure" | "graph" | "llm" | "outbox";

const SECTIONS: { id: Section; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "identity", label: "Identity" },
  { id: "structure", label: "Org structure" },
  { id: "graph", label: "Domain graph" },
  { id: "llm", label: "LLM matrix" },
  { id: "outbox", label: "Event outbox" },
];

export function AdminConsole({
  tenantSlug,
  tenantName,
  program,
  programs,
  enrollableLearners,
  roster,
  rosterCohortName,
  memberships,
  graph,
  matrix,
  events,
  learnerCount,
  avgMastery,
  openAlerts,
  highAlerts,
  backendOk,
}: {
  tenantSlug: string;
  tenantName: string;
  program: ProgramNode;
  programs: ManagedProgram[];
  enrollableLearners: EnrollableLearner[];
  roster: RosterRow[];
  rosterCohortName: string;
  memberships: MembershipRow[];
  graph: DomainGraphData;
  matrix: ScopeRow[];
  events: OutboxEvent[];
  learnerCount: number;
  avgMastery: number | null;
  openAlerts: number;
  highAlerts: number;
  backendOk: boolean;
}) {
  const [section, setSection] = useState<Section>("overview");
  // Newly-written configs are reflected optimistically into the matrix + outbox.
  const [localMatrix, setLocalMatrix] = useState<ScopeRow[]>(matrix);
  const [localEvents, setLocalEvents] = useState<OutboxEvent[]>(events);

  return (
    <div>
      <div className="spread" style={{ alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 12 }}>
        <p className="kicker" style={{ margin: 0 }}>
          Control plane · {tenantName}
        </p>
        {/* tenant scope chip — always visible */}
        <span
          className={a.scopeChip}
          title="Tenant scope is always in view. Every backend call is bearer-JWT scoped to this tenant."
        >
          <span className={a.scopeBadge}>tenant</span>
          <span>{tenantName}</span>
          <span className="quiet">· {tenantSlug}</span>
          <span className={a.scopeDiv} />
          <span className={a.scopeRole}>TENANT_ADMIN</span>
        </span>
      </div>

      <h1 className="standfirst" style={{ marginTop: 6, marginBottom: 6 }}>
        You configure the learning OS — you don&apos;t author syllabi.
      </h1>
      <p className="soft" style={{ maxWidth: "62ch", marginBottom: backendOk ? 20 : 14 }}>
        The runtime owns mastery, reviews, misconceptions and alerts. You shape{" "}
        <em>who</em> is in the tenant, <em>how</em> it is structured, and <em>which model</em> generates
        content.
      </p>

      {!backendOk ? (
        <div className={a.degraded} role="status">
          <span className="mark alarm">degraded</span>
          <span>
            Some runtime reads didn&apos;t answer — the overview metrics, domain graph or outbox below may be
            incomplete. Identity, structure and LLM configuration still work; nothing shown is fabricated to
            fill the gap.
          </span>
        </div>
      ) : null}

      <nav className={a.nav} aria-label="Admin sections">
        {SECTIONS.map((sx) => (
          <button
            key={sx.id}
            type="button"
            className={classNames(a.navBtn, section === sx.id && a.navOn)}
            aria-current={section === sx.id ? "page" : undefined}
            onClick={() => setSection(sx.id)}
          >
            {sx.label}
          </button>
        ))}
      </nav>

      {section === "overview" ? (
        <Overview
          tenantName={tenantName}
          tenantSlug={tenantSlug}
          domainName={graph.domainName}
          learnerCount={learnerCount}
          cohortName={program.cohorts[0]?.name ?? "—"}
          programName={program.name}
          matrix={localMatrix}
          avgMastery={avgMastery}
          openAlerts={openAlerts}
          highAlerts={highAlerts}
          onGoto={() => setSection("llm")}
        />
      ) : null}

      {section === "identity" ? <IdentityManager memberships={memberships} tenantSlug={tenantSlug} /> : null}

      {section === "structure" ? (
        <OrgManager
          program={program}
          programs={programs}
          learners={enrollableLearners}
          roster={roster}
          rosterCohortName={rosterCohortName}
          tenantSlug={tenantSlug}
        />
      ) : null}

      {section === "graph" ? <DomainGraph graph={graph} /> : null}

      {section === "llm" ? (
        <LlmMatrix
          tenantSlug={tenantSlug}
          matrix={localMatrix}
          learners={program.cohorts[0]?.enrollment.filter((e) => e.role === "LEARNER").map((e) => e.name) ?? []}
          onApplied={(row, event) => {
            setLocalMatrix((m) => m.map((r) => (r.tier === row.tier && r.scopeId === row.scopeId ? row : r)));
            setLocalEvents((e) => [event, ...e]);
            setSection("outbox");
          }}
        />
      ) : null}

      {section === "outbox" ? <EventOutbox events={localEvents} /> : null}
    </div>
  );
}
