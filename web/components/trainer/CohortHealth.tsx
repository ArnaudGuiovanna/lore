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
  cohortId,
  onInspect,
}: {
  analytics: CohortAnalytics | null;
  learners: LearnerRow[];
  cohortName: string;
  cohortId?: string;
  onInspect?: (id: string) => void;
}) {
  // Per-learner FOAD hours (B-07) — paused intervals excluded by the backend.
  const hoursByLearner = new Map(
    (analytics?.learner_time ?? []).map((t) => [t.learner_id, t.training_hours])
  );
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
      header: "Apprenant",
      render: (r) => (
        <div className="col" style={{ gap: 2 }}>
          <span style={{ fontFamily: "var(--serif)", fontSize: 16 }}>{r.name}</span>
          <span className="quiet mono" style={{ fontSize: 10 }}>{r.id}</span>
        </div>
      ),
    },
    {
      key: "avgMastery",
      header: "Maîtrise",
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
      header: "Rétention",
      align: "right",
      mono: true,
      render: (r) => (
        <span style={{ color: (r.avgRetention ?? 1) < 0.6 ? "var(--amber)" : "var(--ink)" }}>
          {fmtPct(r.avgRetention)}
        </span>
      ),
    },
    { key: "tracked", header: "Suivis", align: "right", mono: true },
    {
      key: "due",
      header: "À faire",
      align: "right",
      mono: true,
      render: (r) => <span style={{ color: r.due ? "var(--amber)" : "var(--muted)" }}>{r.due}</span>,
    },
    {
      key: "hours",
      header: "Heures",
      align: "right",
      mono: true,
      render: (r) => {
        const hours = hoursByLearner.get(r.id);
        return hours === undefined ? (
          <span className="quiet">—</span>
        ) : (
          <span>{hours.toFixed(1)} h</span>
        );
      },
    },
    {
      key: "openAlerts",
      header: "Alertes",
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
            {atRisk ? "à risque" : r.due ? "à réviser" : "sur la bonne voie"}
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
        kicker={`Santé du groupe · ${cohortName}`}
        title="Où en est réellement le groupe"
        aside={<SourceMark source="runtime" label="état durable" />}
      >
        <p className="soft" style={{ marginTop: -6, marginBottom: 18, maxWidth: "62ch" }}>
          Des preuves, pas de la vanité. Elles viennent directement de <code>analytics/cohorts/{"{cohort}"}</code> —
          l&apos;état durable consolidé du runtime.
        </p>
        {!analytics ? (
          <p className="mono" style={{ color: "var(--amber)", fontSize: 12, marginBottom: 16 }}>
            Les analytics du groupe n&apos;ont pas répondu — les chiffres consolidés sont indisponibles. La liste
            par apprenant ci-dessous est calculée à partir de l&apos;état durable et reste faisant autorité.
          </p>
        ) : null}
        <div className="row" style={{ gap: 30, flexWrap: "wrap" }}>
          <Metric label="apprenants" value={analytics?.learner_count ?? learners.length} />
          <Metric
            label="maîtrise moyenne"
            value={fmtPct(analytics?.average_mastery)}
            tone={(analytics?.average_mastery ?? 1) < 0.3 ? "alarm" : "ink"}
          />
          <Metric label="états suivis" value={analytics?.state_count ?? "—"} />
          <Metric
            label="conceptions erronées actives"
            value={analytics ? analytics.active_misconceptions : "—"}
            tone={(analytics?.active_misconceptions ?? 0) > 0 ? "alarm" : "ink"}
          />
          <Metric
            label="heures de formation (FOAD)"
            value={analytics?.training_hours !== undefined ? `${analytics.training_hours.toFixed(1)} h` : "—"}
          />
        </div>
        {cohortId ? (
          <p style={{ marginTop: 14, marginBottom: 0 }}>
            <a
              className="mono"
              style={{ fontSize: 12, color: "var(--accent)" }}
              href={`/api/analytics/training-time?cohortId=${encodeURIComponent(cohortId)}`}
            >
              ↓ exporter le temps de formation par apprenant (CSV)
            </a>
          </p>
        ) : null}
      </Panel>

      <Panel
        kicker="Liste · triée par signal"
        title="Qui a besoin de vous en premier"
        aside={<span className="mono quiet" style={{ fontSize: 11 }}>les plus à risque d&apos;abord</span>}
      >
        <DataTable<Row>
          columns={columns}
          rows={sorted as Row[]}
          rowKey={(r) => r.id}
          empty="Aucun apprenant inscrit."
        />
        {onInspect ? (
          <p className="quiet mono" style={{ fontSize: 11, marginTop: 12 }}>
            Ouvrez Inspection pour lire la chronologie des instantanés d&apos;un apprenant.
          </p>
        ) : null}
      </Panel>
    </div>
  );
}
