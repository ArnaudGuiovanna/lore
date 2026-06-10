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
import { SessionsManager } from "./SessionsManager";
import { ImportLearners } from "./ImportLearners";
import { DomainGraph } from "./DomainGraph";
import { LlmMatrix } from "./LlmMatrix";
import { EventOutbox } from "./EventOutbox";
import a from "./admin.module.css";

type Section = "overview" | "identity" | "structure" | "sessions" | "import" | "graph" | "llm" | "outbox";

const SECTIONS: { id: Section; label: string }[] = [
  { id: "overview", label: "Vue d'ensemble" },
  { id: "identity", label: "Identité" },
  { id: "structure", label: "Structure de l'organisation" },
  { id: "sessions", label: "Sessions" },
  { id: "import", label: "Import CSV" },
  { id: "graph", label: "Graphe du domaine" },
  { id: "llm", label: "Matrice LLM" },
  { id: "outbox", label: "Boîte d'événements" },
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
  trainingHours,
  trainingTimeCsvHref,
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
  trainingHours?: number | null;
  trainingTimeCsvHref?: string;
  backendOk: boolean;
}) {
  const [section, setSection] = useState<Section>("overview");
  // Newly-written configs are reflected optimistically into the matrix + outbox.
  const [localMatrix, setLocalMatrix] = useState<ScopeRow[]>(matrix);
  const [localEvents, setLocalEvents] = useState<OutboxEvent[]>(events);

  return (
    <div>
      <div className="spread" style={{ alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 12 }}>
        <p className="kicker" style={{ margin: 0 }} data-testid="control-plane-kicker">
          Plan de contrôle · {tenantName}
        </p>
        {/* tenant scope chip — always visible */}
        <span
          className={a.scopeChip}
          title="Le périmètre du tenant est toujours visible. Chaque appel backend est limité à ce tenant par un JWT porteur."
        >
          <span className={a.scopeBadge}>tenant</span>
          <span>{tenantName}</span>
          <span className="quiet">· {tenantSlug}</span>
          <span className={a.scopeDiv} />
          <span className={a.scopeRole}>TENANT_ADMIN</span>
        </span>
      </div>

      <h1 className="standfirst" style={{ marginTop: 6, marginBottom: 6 }}>
        Vous configurez l&apos;OS d&apos;apprentissage — vous ne rédigez pas de syllabus.
      </h1>
      <p className="soft" style={{ maxWidth: "62ch", marginBottom: backendOk ? 20 : 14 }}>
        Le runtime détient la maîtrise, les révisions, les conceptions erronées et les alertes. Vous façonnez{" "}
        <em>qui</em> se trouve dans le tenant, <em>comment</em> il est structuré, et <em>quel modèle</em> génère
        le contenu.
      </p>

      {!backendOk ? (
        <div className={a.degraded} role="status">
          <span className="mark alarm">dégradé</span>
          <span>
            Certaines lectures du runtime n&apos;ont pas répondu — les métriques de la vue d&apos;ensemble, le graphe
            du domaine ou la boîte d&apos;événements ci-dessous peuvent être incomplets. L&apos;identité, la structure
            et la configuration LLM fonctionnent toujours ; rien n&apos;est inventé pour combler le manque.
          </span>
        </div>
      ) : null}

      <nav className={a.nav} aria-label="Sections d'administration">
        {SECTIONS.map((sx) => (
          <button
            key={sx.id}
            type="button"
            data-testid={`admin-nav-${sx.id}`}
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
          trainingHours={trainingHours}
          trainingTimeCsvHref={trainingTimeCsvHref}
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

      {section === "sessions" ? <SessionsManager programs={programs} /> : null}

      {section === "import" ? <ImportLearners programs={programs} /> : null}

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
