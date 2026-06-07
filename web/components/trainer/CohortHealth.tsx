"use client";

import { Panel } from "@/components/ui/Panel";
import { Metric } from "@/components/ui/Metric";
import { DataTable } from "@/components/ui/DataTable";
import type { Column } from "@/components/ui/DataTable";
import { SourceMark } from "@/components/runtime/SourceMark";
import { RosterAttestationLink } from "@/components/certificates/DownloadAttestation";
import { fmtPct } from "@/lib/format";
import type { CohortAnalytics, LearnerRow } from "./types";

// A roster row as a plain record for the generic DataTable.
type Row = LearnerRow & Record<string, unknown>;

// COHORT HEALTH: cohort analytics KPIs + a roster sorted by signal (most at-risk first).
// Every number is runtime-owned evidence (mastery/retention from BKT/FSRS) — not vanity.
export function CohortHealth({
  analytics,
  learners,
  cohortName,
  onInspect,
}: {
  analytics: CohortAnalytics | null;
  learners: LearnerRow[];
  cohortName: string;
  onInspect?: (id: string) => void;
}) {
  // signal score: open alerts, relearning, low mastery → top.
  const sorted = [...learners].sort(
    (a, b) =>
      b.openAlerts - a.openAlerts ||
      b.relearning - a.relearning ||
      b.due - a.due ||
      (a.avgMastery ?? 1) - (b.avgMastery ?? 1)
  );

  const columns: Column<Row>[] = [
    {
      key: "name",
      header: "Learner",
      render: (r) => (
        <div className="col" style={{ gap: 2 }}>
          <span style={{ fontFamily: "var(--serif)", fontSize: 16 }}>{r.name}</span>
          <span className="quiet mono" style={{ fontSize: 10 }}>{r.id}</span>
        </div>
      ),
    },
    {
      key: "avgMastery",
      header: "Mastery",
      align: "right",
      mono: true,
      render: (r) => (
        <span style={{ color: (r.avgMastery ?? 1) < 0.3 ? "var(--alarm)" : "var(--ink)" }}>
          {fmtPct(r.avgMastery)}
        </span>
      ),
    },
    {
      key: "avgRetention",
      header: "Retention",
      align: "right",
      mono: true,
      render: (r) => (
        <span style={{ color: (r.avgRetention ?? 1) < 0.6 ? "var(--amber)" : "var(--ink)" }}>
          {fmtPct(r.avgRetention)}
        </span>
      ),
    },
    { key: "tracked", header: "Tracked", align: "right", mono: true },
    {
      key: "due",
      header: "Due",
      align: "right",
      mono: true,
      render: (r) => <span style={{ color: r.due ? "var(--amber)" : "var(--muted)" }}>{r.due}</span>,
    },
    {
      key: "openAlerts",
      header: "Alerts",
      align: "right",
      mono: true,
      render: (r) => <span style={{ color: r.openAlerts ? "var(--alarm)" : "var(--muted)" }}>{r.openAlerts}</span>,
    },
    {
      key: "signal",
      header: "Signal",
      render: (r) => {
        const atRisk = r.openAlerts > 0 || r.relearning > 0 || (r.avgMastery ?? 1) < 0.3;
        return (
          <span className={`pill ${atRisk ? "" : "on"}`}>
            {atRisk ? "at risk" : r.due ? "review" : "on track"}
          </span>
        );
      },
    },
    {
      key: "attestation",
      header: "Attestation",
      // Per-learner completion attestation (PDF). Only offered once the runtime has
      // tracked >= 1 concept — no attestation for a learner with no evidence yet.
      render: (r) =>
        r.tracked > 0 ? (
          <RosterAttestationLink learnerId={r.id} />
        ) : (
          <span className="quiet mono" style={{ fontSize: 11 }}>—</span>
        ),
    },
  ];

  return (
    <div className="col" style={{ gap: 22 }}>
      <Panel
        kicker={`Cohort health · ${cohortName}`}
        title="Where the cohort actually is"
        aside={<SourceMark source="runtime" label="durable state" />}
      >
        <p className="soft" style={{ marginTop: -6, marginBottom: 18, maxWidth: "62ch" }}>
          Evidence, not vanity. These come straight from <code>analytics/cohorts/{"{cohort}"}</code> — the
          runtime&apos;s rolled-up durable state.
        </p>
        {!analytics ? (
          <p className="mono" style={{ color: "var(--amber)", fontSize: 12, marginBottom: 16 }}>
            Cohort analytics didn&apos;t answer — the rolled-up figures are unavailable. The per-learner roster
            below is computed from durable state and is still authoritative.
          </p>
        ) : null}
        <div className="row" style={{ gap: 30, flexWrap: "wrap" }}>
          <Metric label="learners" value={analytics?.learner_count ?? learners.length} />
          <Metric
            label="average mastery"
            value={fmtPct(analytics?.average_mastery)}
            tone={(analytics?.average_mastery ?? 1) < 0.3 ? "alarm" : "ink"}
          />
          <Metric label="states tracked" value={analytics?.state_count ?? "—"} />
          <Metric
            label="active misconceptions"
            value={analytics ? analytics.active_misconceptions : "—"}
            tone={(analytics?.active_misconceptions ?? 0) > 0 ? "alarm" : "ink"}
          />
        </div>
      </Panel>

      <Panel
        kicker="Roster · sorted by signal"
        title="Who needs you first"
        aside={<span className="mono quiet" style={{ fontSize: 11 }}>most at-risk first</span>}
      >
        <DataTable<Row>
          columns={columns}
          rows={sorted as Row[]}
          rowKey={(r) => r.id}
          empty="No learners enrolled."
        />
        {onInspect ? (
          <p className="quiet mono" style={{ fontSize: 11, marginTop: 12 }}>
            Open Inspection to read any learner&apos;s snapshot timeline.
          </p>
        ) : null}
      </Panel>
    </div>
  );
}
