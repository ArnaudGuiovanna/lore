"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/ui/Panel";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { OrgStructure } from "./OrgStructure";
import type {
  EnrollableLearner,
  ManagedProgram,
  ProgramNode,
  RosterRow,
} from "./types";
import a from "./admin.module.css";

// Org management: create programs and cohorts, enroll learners, and read the
// live roster (enrolled learners + their runtime-owned state). Syllabi remain
// trainer-owned and read-only here (see OrgStructure).
export function OrgManager({
  program,
  programs,
  learners,
  roster,
  rosterCohortName,
  tenantSlug,
}: {
  program: ProgramNode;
  programs: ManagedProgram[];
  learners: EnrollableLearner[];
  roster: RosterRow[];
  rosterCohortName: string;
  tenantSlug: string;
}) {
  const router = useRouter();

  // ---- create program ----
  const [pName, setPName] = useState("");
  const [pBusy, setPBusy] = useState(false);
  const [pErr, setPErr] = useState<string | null>(null);

  // ---- create cohort ----
  const allCohorts = useMemo(() => programs.flatMap((p) => p.cohorts), [programs]);
  const [cProgram, setCProgram] = useState(programs[0]?.id ?? "");
  const [cName, setCName] = useState("");
  const today = new Date().toISOString().slice(0, 10);
  const [cStart, setCStart] = useState(today);
  const [cEnd, setCEnd] = useState(today);
  const [cBusy, setCBusy] = useState(false);
  const [cErr, setCErr] = useState<string | null>(null);

  // ---- enroll ----
  const [eCohort, setECohort] = useState(allCohorts[0]?.id ?? "");
  const [eLearner, setELearner] = useState(learners[0]?.id ?? "");
  const [eBusy, setEBusy] = useState(false);
  const [eErr, setEErr] = useState<string | null>(null);
  const [eOk, setEOk] = useState<string | null>(null);

  async function createProgram(e: React.FormEvent) {
    e.preventDefault();
    setPBusy(true);
    setPErr(null);
    try {
      const res = await fetch("/api/admin/programs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: pName }),
      });
      const data = await res.json();
      if (!res.ok) { setPErr(data?.error || `HTTP ${res.status}`); setPBusy(false); return; }
      setPName("");
      setPBusy(false);
      router.refresh();
    } catch (err) {
      setPErr(err instanceof Error ? err.message : "erreur réseau");
      setPBusy(false);
    }
  }

  async function createCohort(e: React.FormEvent) {
    e.preventDefault();
    setCBusy(true);
    setCErr(null);
    try {
      const res = await fetch("/api/admin/cohorts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ program_id: cProgram, name: cName, start_date: cStart, end_date: cEnd }),
      });
      const data = await res.json();
      if (!res.ok) { setCErr(data?.error || `HTTP ${res.status}`); setCBusy(false); return; }
      setCName("");
      setCBusy(false);
      router.refresh();
    } catch (err) {
      setCErr(err instanceof Error ? err.message : "erreur réseau");
      setCBusy(false);
    }
  }

  async function enroll(e: React.FormEvent) {
    e.preventDefault();
    setEBusy(true);
    setEErr(null);
    setEOk(null);
    try {
      const res = await fetch("/api/admin/enroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cohort_id: eCohort, learner_id: eLearner }),
      });
      const data = await res.json();
      if (!res.ok) { setEErr(data?.error || `HTTP ${res.status}`); setEBusy(false); return; }
      const who = learners.find((l) => l.id === eLearner)?.name ?? eLearner;
      setEOk(`${who} inscrit(e).`);
      setEBusy(false);
      router.refresh();
    } catch (err) {
      setEErr(err instanceof Error ? err.message : "erreur réseau");
      setEBusy(false);
    }
  }

  const rosterCols: Column<Record<string, unknown>>[] = [
    {
      key: "name",
      header: "Apprenant",
      render: (r) => {
        const row = r as unknown as RosterRow;
        return (
          <div className="col" style={{ gap: 2 }}>
            <span style={{ fontFamily: "var(--serif)", fontSize: 16, color: "var(--ink)" }}>{row.name}</span>
            <span className="mono quiet" style={{ fontSize: 10.5 }}>{row.learnerId}</span>
          </div>
        );
      },
    },
    {
      key: "mastery",
      header: "Maîtrise moy.",
      mono: true,
      render: (r) => {
        const row = r as unknown as RosterRow;
        if (row.avgMastery == null) return <span className="quiet">— aucun état runtime —</span>;
        return (
          <span style={{ color: "var(--accent)" }}>
            {(row.avgMastery * 100).toFixed(0)}% <span className="quiet">· {row.concepts} concepts</span>
          </span>
        );
      },
    },
    {
      key: "due",
      header: "Révisions à faire",
      mono: true,
      render: (r) => {
        const row = r as unknown as RosterRow;
        return row.dueReviews == null ? <span className="quiet">—</span> : <span>{row.dueReviews}</span>;
      },
    },
  ];

  const rosterRows = roster.map((r) => ({ ...r })) as unknown as Record<string, unknown>[];

  return (
    <div className="col" style={{ gap: 22 }}>
      {/* CREATE program + cohort */}
      <Panel
        kicker="Conteneurs"
        title="Créer des programmes et des groupes"
        aside={<span className="mono quiet" style={{ fontSize: 11 }}>POST /v1/tenants/{tenantSlug}/programs · /cohorts</span>}
      >
        <div className={a.orgForms}>
          <form onSubmit={createProgram} className="col" style={{ gap: 12 }} aria-label="Créer un programme">
            <span className="kicker" style={{ margin: 0 }}>Nouveau programme</span>
            <div>
              <label className={a.fieldLabel} htmlFor="prog-name">Nom du programme</label>
              <input
                id="prog-name"
                className={a.input}
                value={pName}
                onChange={(e) => setPName(e.target.value)}
                placeholder="Backend Engineering 2027"
                required
              />
            </div>
            <div>
              <button type="submit" className="btn primary" disabled={pBusy}>
                {pBusy ? "Création…" : "Créer le programme →"}
              </button>
            </div>
            {pErr ? <p className="mono" style={{ color: "var(--alarm)", fontSize: 12.5, margin: 0 }}>{pErr}</p> : null}
          </form>

          <form onSubmit={createCohort} className="col" style={{ gap: 12 }} aria-label="Créer un groupe">
            <span className="kicker" style={{ margin: 0 }}>Nouveau groupe</span>
            <div>
              <label className={a.fieldLabel} htmlFor="coh-prog">Dans le programme</label>
              <select id="coh-prog" className={a.select} value={cProgram} onChange={(e) => setCProgram(e.target.value)} required>
                {programs.length === 0 ? <option value="">— créez d&apos;abord un programme —</option> : null}
                {programs.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={a.fieldLabel} htmlFor="coh-name">Nom du groupe</label>
              <input
                id="coh-name"
                className={a.input}
                value={cName}
                onChange={(e) => setCName(e.target.value)}
                placeholder="Go-Spring-27"
                required
              />
            </div>
            <div className="row" style={{ gap: 12 }}>
              <div style={{ flex: 1 }}>
                <label className={a.fieldLabel} htmlFor="coh-start">Début</label>
                <input id="coh-start" className={a.input} type="date" value={cStart} onChange={(e) => setCStart(e.target.value)} required />
              </div>
              <div style={{ flex: 1 }}>
                <label className={a.fieldLabel} htmlFor="coh-end">Fin</label>
                <input id="coh-end" className={a.input} type="date" value={cEnd} onChange={(e) => setCEnd(e.target.value)} required />
              </div>
            </div>
            <div>
              <button type="submit" className="btn primary" disabled={cBusy || programs.length === 0}>
                {cBusy ? "Création…" : "Créer le groupe →"}
              </button>
            </div>
            {cErr ? <p className="mono" style={{ color: "var(--alarm)", fontSize: 12.5, margin: 0 }}>{cErr}</p> : null}
          </form>
        </div>
      </Panel>

      {/* ENROLL a learner */}
      <Panel
        kicker="Inscription"
        title="Inscrire un apprenant dans un groupe"
        aside={<span className="mono quiet" style={{ fontSize: 11 }}>POST /v1/tenants/{tenantSlug}/cohorts/{"{cohort}"}/enrollments</span>}
      >
        <form onSubmit={enroll} className={a.enrollGrid} aria-label="Inscrire un apprenant">
          <div>
            <label className={a.fieldLabel} htmlFor="enr-learner">Apprenant</label>
            <select id="enr-learner" className={a.select} value={eLearner} onChange={(e) => setELearner(e.target.value)} required>
              {learners.length === 0 ? <option value="">— aucun apprenant connu —</option> : null}
              {learners.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={a.fieldLabel} htmlFor="enr-cohort">Dans le groupe</label>
            <select id="enr-cohort" className={a.select} value={eCohort} onChange={(e) => setECohort(e.target.value)} required>
              {allCohorts.length === 0 ? <option value="">— créez d&apos;abord un groupe —</option> : null}
              {allCohorts.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className={a.inviteAction}>
            <button type="submit" className="btn primary" disabled={eBusy || allCohorts.length === 0 || learners.length === 0}>
              {eBusy ? "Inscription…" : "Inscrire →"}
            </button>
          </div>
        </form>
        {eErr ? <p className="mono" role="alert" style={{ color: "var(--alarm)", fontSize: 12.5, marginTop: 12 }}>{eErr}</p> : null}
        {eOk ? <p className="mono" role="status" style={{ color: "var(--accent)", fontSize: 12.5, marginTop: 12 }}>{eOk}</p> : null}
      </Panel>

      {/* ROSTER with live runtime state */}
      <Panel
        kicker="Liste"
        title={`${rosterCohortName} · apprenants inscrits`}
        aside={<span className="mono quiet" style={{ fontSize: 11 }}>GET …/learners/{"{id}"}/state · reviews/due</span>}
      >
        <p className="soft" style={{ marginTop: 0, marginBottom: 14, maxWidth: "62ch", fontSize: 15 }}>
          Le runtime détient la maîtrise et la planification des révisions — les chiffres ci-dessous en sont lus,
          jamais recalculés ici. Un apprenant sans état runtime n&apos;affiche simplement rien.
        </p>
        <DataTable
          columns={rosterCols}
          rows={rosterRows}
          rowKey={(r) => (r as unknown as RosterRow).learnerId}
          empty="Aucun apprenant inscrit dans ce groupe pour l'instant."
        />
      </Panel>

      {/* READ-ONLY org-structure tree (existing presentational view) */}
      <OrgStructure program={program} />
    </div>
  );
}
