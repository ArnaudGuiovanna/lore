"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
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
import { InvitesManager } from "./InvitesManager";
import { DomainGraph } from "./DomainGraph";
import { LlmMatrix } from "./LlmMatrix";
import { EventOutbox } from "./EventOutbox";
import { Conformite } from "./conformite/Conformite";
import {
  asAdminSection,
  adminDefaultSectionForRole,
  adminSectionsForRole,
  type AdminSection as Section,
} from "./sections";
import a from "./admin.module.css";

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
  publicBaseUrl,
  backendOk,
  role = "TENANT_ADMIN",
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
  publicBaseUrl?: string;
  backendOk: boolean;
  // B-27 : le GESTIONNAIRE partage cette console mais ne voit que les sections
  // administratives (jamais LLM, graphe, outbox ni vue d'ensemble).
  role?: string;
}) {
  const isManager = role === "GESTIONNAIRE";
  const allowed = adminSectionsForRole(role).map((s) => s.id);
  const defaultSection = adminDefaultSectionForRole(role);
  // The rendered section is addressable: /admin?section=… (UX-01). The URL is
  // the shared source of truth with the lateral AppNav; programmatic jumps
  // update it shallowly so links stay shareable without refetching the page.
  const urlSection = asAdminSection(useSearchParams().get("section"), role);
  const [section, setSection] = useState<Section>(urlSection);
  useEffect(() => {
    setSection(urlSection);
  }, [urlSection]);
  function go(next: Section) {
    const target = allowed.includes(next) ? next : defaultSection;
    setSection(target);
    window.history.replaceState(
      null,
      "",
      target === defaultSection ? "/admin" : `/admin?section=${target}`
    );
  }
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
          <span className={a.scopeRole}>{isManager ? "GESTIONNAIRE" : "TENANT_ADMIN"}</span>
        </span>
      </div>

      {isManager ? (
        <>
          <h1 className="standfirst" style={{ marginTop: 6, marginBottom: 6 }}>
            Vous administrez l&apos;organisme — pas sa configuration technique.
          </h1>
          <p className="soft" style={{ maxWidth: "62ch", marginBottom: backendOk ? 20 : 14 }}>
            Inscriptions, sessions, documents, financements et qualité. La conception pédagogique reste aux
            formateurs ; la configuration LLM et les intégrations restent aux administrateurs.
          </p>
        </>
      ) : (
        <>
          <h1 className="standfirst" style={{ marginTop: 6, marginBottom: 6 }}>
            Vous configurez l&apos;OS d&apos;apprentissage — vous ne rédigez pas de syllabus.
          </h1>
          <p className="soft" style={{ maxWidth: "62ch", marginBottom: backendOk ? 20 : 14 }}>
            Le runtime détient la maîtrise, les révisions, les conceptions erronées et les alertes. Vous façonnez{" "}
            <em>qui</em> se trouve dans le tenant, <em>comment</em> il est structuré, et <em>quel modèle</em> génère
            le contenu.
          </p>
        </>
      )}

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

      {section === "overview" && !isManager ? (
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
          onGoto={() => go("llm")}
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

      {section === "invites" ? <InvitesManager programs={programs} publicBaseUrl={publicBaseUrl} /> : null}

      {section === "graph" && !isManager ? <DomainGraph graph={graph} /> : null}

      {section === "llm" && !isManager ? (
        <LlmMatrix
          tenantSlug={tenantSlug}
          matrix={localMatrix}
          learners={program.cohorts[0]?.enrollment.filter((e) => e.role === "LEARNER").map((e) => e.name) ?? []}
          onApplied={(row, event) => {
            setLocalMatrix((m) => m.map((r) => (r.tier === row.tier && r.scopeId === row.scopeId ? row : r)));
            setLocalEvents((e) => [event, ...e]);
            go("outbox");
          }}
        />
      ) : null}

      {section === "outbox" && !isManager ? <EventOutbox events={localEvents} /> : null}

      {section === "conformite" ? (
        <Conformite
          cohorts={programs.flatMap((p) => p.cohorts.map((c) => ({ id: c.id, name: c.name })))}
          learners={enrollableLearners.map((l) => ({ id: l.id, name: l.name }))}
          people={memberships
            .filter((m) => !!m.userId)
            .map((m) => ({ id: m.userId as string, name: m.name }))}
          canErase={!isManager}
        />
      ) : null}
    </div>
  );
}
