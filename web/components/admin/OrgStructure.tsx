import { Panel } from "@/components/ui/Panel";
import type { ProgramNode } from "./types";
import a from "./admin.module.css";

// Org structure: programs › cohorts › enrollment (people + containers).
// Bound syllabi are shown READ-ONLY for governance — no create/edit affordance.
// Syllabi are authored by trainers, not the admin.
export function OrgStructure({ program }: { program: ProgramNode }) {
  return (
    <div className="col" style={{ gap: 22 }}>
      <p className="soft" style={{ maxWidth: "62ch", margin: 0 }}>
        Your structure is <em>people and containers</em>: programs hold cohorts, cohorts hold enrolled
        learners and a trainer lead. You shape <em>who</em> belongs where — you do <em>not</em> author
        syllabi.
      </p>

      <Panel
        kicker="Org structure"
        title="Programs › cohorts › enrollment"
        aside={<span className="mono quiet" style={{ fontSize: 11 }}>programs · cohorts · enrollment</span>}
      >
        <div className={a.tree} role="tree" aria-label="Tenant org-structure tree">
          {/* program */}
          <div role="treeitem" aria-expanded="true">
            <div className={`${a.trow} ${a.l1}`}>
              <span className={a.ticon}>▣</span>
              <span className={a.tlabel}>{program.name}</span>
              <span className={a.tmeta}>program · {program.cohorts.length} cohort</span>
            </div>

            {program.cohorts.map((c) => (
              <div key={c.id} role="treeitem" aria-expanded="true">
                <div className={`${a.trow} ${a.l2}`}>
                  <span className={a.ticon}>◫</span>
                  <span className={a.tlabel}>{c.name}</span>
                  <span className={a.tmeta}>
                    cohort · {c.enrollment.filter((e) => e.role === "LEARNER").length + c.extraLearners} learners
                    · lead {c.leadName}
                  </span>
                </div>

                {/* enrollment — the admin's real scope */}
                <div role="treeitem" aria-expanded="true">
                  <div className={`${a.trow} ${a.l3}`}>
                    <span className={a.ticon}>◷</span>
                    <span className={a.tlabel}>Enrollment</span>
                    <span className={a.tmeta}>
                      {c.enrollment.filter((e) => e.role === "LEARNER").length + c.extraLearners} learners · 1
                      trainer lead
                    </span>
                  </div>
                  {c.enrollment.map((m) => (
                    <div key={m.name} role="treeitem" className={`${a.trow} ${a.l4}`}>
                      <span className={a.ticon}>·</span>
                      <span className={a.tlabel}>{m.name}</span>
                      <span className={a.tmeta}>
                        <span className={`${a.rolePill} ${m.role === "TRAINER" ? a.roleTrainer : a.roleLearner}`}>
                          {m.role === "TRAINER" ? `trainer${m.lead ? " · lead" : ""}` : "learner"}
                        </span>
                      </span>
                    </div>
                  ))}
                  {c.extraLearners > 0 ? (
                    <div role="treeitem" className={`${a.trow} ${a.l4}`}>
                      <span className={a.ticon}>·</span>
                      <span className={`${a.tlabel} ${a.tlabelGhost}`}>+ {c.extraLearners} more enrolled learners</span>
                      <span className={a.tmeta}>
                        <span className={`${a.rolePill} ${a.roleLearner}`}>learner</span>
                      </span>
                    </div>
                  ) : null}
                </div>

                {/* bound syllabi — READ-ONLY for the admin */}
                <div role="treeitem" aria-expanded="true">
                  <div className={`${a.trow} ${a.l3}`}>
                    <span className={`${a.ticon} ${a.ticonGhost}`}>≣</span>
                    <span className={`${a.tlabel} ${a.tlabelGhost}`}>
                      Bound syllabi <span className="mono quiet" style={{ fontSize: 10 }}>(read-only)</span>
                    </span>
                    <span className={a.tmeta}>{c.bound.length} binding · authored by trainer</span>
                  </div>
                  {c.bound.map((b) => (
                    <div key={b.syllabusId}>
                      <div role="treeitem" className={`${a.trow} ${a.l4}`}>
                        <span className={a.ticon}>·</span>
                        <span className={`${a.tlabel} ${a.tlabelGhost}`}>{b.title}</span>
                        <span className={a.tmeta}>
                          <span className={a.tbinding}>
                            {b.targetType} · {b.adaptationMode} · view-only
                          </span>
                        </span>
                      </div>
                      <div role="treeitem" className={`${a.trow} ${a.l4}`}>
                        <span className={a.ticon}>·</span>
                        <span className={a.tmono}>
                          syllabus_binding · target_type={b.targetType} · target_id={b.targetId.slice(0, 8)}
                        </span>
                      </div>
                      <div role="treeitem" className={`${a.trow} ${a.l4}`}>
                        <span className={a.ticon}>·</span>
                        <span className={a.tmono}>
                          author {b.author} · scopes domain {b.domainName}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </Panel>

      <div className={a.note}>
        <span className={a.noteIco} aria-hidden="true">≣</span>
        <span>
          <b>Syllabi are authored by trainers</b> (Trainer console), not by the admin. A trainer states intent
          — title, objectives, outcomes — and attaches a cohort; that binding lets the runtime + LLM generate
          each learner&apos;s parcours over the concept DAG. You see the binding here <b>read-only</b> for
          governance — there is no create-syllabus or edit-binding affordance in the control plane. Your
          levers are programs, cohorts and enrollment.
        </span>
      </div>
    </div>
  );
}
