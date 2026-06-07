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
        Votre structure, ce sont des <em>personnes et des conteneurs</em> : les programmes contiennent des groupes,
        les groupes contiennent des apprenants inscrits et un formateur référent. Vous façonnez <em>qui</em>
        appartient où — vous ne rédigez <em>pas</em> de syllabus.
      </p>

      <Panel
        kicker="Structure de l'organisation"
        title="Programmes › groupes › inscriptions"
        aside={<span className="mono quiet" style={{ fontSize: 11 }}>programmes · groupes · inscriptions</span>}
      >
        <div className={a.tree} role="tree" aria-label="Arborescence de la structure du tenant">
          {/* program */}
          <div role="treeitem" aria-expanded="true">
            <div className={`${a.trow} ${a.l1}`}>
              <span className={a.ticon}>▣</span>
              <span className={a.tlabel}>{program.name}</span>
              <span className={a.tmeta}>programme · {program.cohorts.length} groupe</span>
            </div>

            {program.cohorts.map((c) => (
              <div key={c.id} role="treeitem" aria-expanded="true">
                <div className={`${a.trow} ${a.l2}`}>
                  <span className={a.ticon}>◫</span>
                  <span className={a.tlabel}>{c.name}</span>
                  <span className={a.tmeta}>
                    groupe · {c.enrollment.filter((e) => e.role === "LEARNER").length + c.extraLearners} apprenants
                    · référent {c.leadName}
                  </span>
                </div>

                {/* enrollment — the admin's real scope */}
                <div role="treeitem" aria-expanded="true">
                  <div className={`${a.trow} ${a.l3}`}>
                    <span className={a.ticon}>◷</span>
                    <span className={a.tlabel}>Inscriptions</span>
                    <span className={a.tmeta}>
                      {c.enrollment.filter((e) => e.role === "LEARNER").length + c.extraLearners} apprenants · 1
                      formateur référent
                    </span>
                  </div>
                  {c.enrollment.map((m) => (
                    <div key={m.name} role="treeitem" className={`${a.trow} ${a.l4}`}>
                      <span className={a.ticon}>·</span>
                      <span className={a.tlabel}>{m.name}</span>
                      <span className={a.tmeta}>
                        <span className={`${a.rolePill} ${m.role === "TRAINER" ? a.roleTrainer : a.roleLearner}`}>
                          {m.role === "TRAINER" ? `formateur${m.lead ? " · référent" : ""}` : "apprenant"}
                        </span>
                      </span>
                    </div>
                  ))}
                  {c.extraLearners > 0 ? (
                    <div role="treeitem" className={`${a.trow} ${a.l4}`}>
                      <span className={a.ticon}>·</span>
                      <span className={`${a.tlabel} ${a.tlabelGhost}`}>+ {c.extraLearners} autres apprenants inscrits</span>
                      <span className={a.tmeta}>
                        <span className={`${a.rolePill} ${a.roleLearner}`}>apprenant</span>
                      </span>
                    </div>
                  ) : null}
                </div>

                {/* bound syllabi — READ-ONLY for the admin */}
                <div role="treeitem" aria-expanded="true">
                  <div className={`${a.trow} ${a.l3}`}>
                    <span className={`${a.ticon} ${a.ticonGhost}`}>≣</span>
                    <span className={`${a.tlabel} ${a.tlabelGhost}`}>
                      Syllabus rattachés <span className="mono quiet" style={{ fontSize: 10 }}>(lecture seule)</span>
                    </span>
                    <span className={a.tmeta}>{c.bound.length} rattachement · rédigé par le formateur</span>
                  </div>
                  {c.bound.map((b) => (
                    <div key={b.syllabusId}>
                      <div role="treeitem" className={`${a.trow} ${a.l4}`}>
                        <span className={a.ticon}>·</span>
                        <span className={`${a.tlabel} ${a.tlabelGhost}`}>{b.title}</span>
                        <span className={a.tmeta}>
                          <span className={a.tbinding}>
                            {b.targetType} · {b.adaptationMode} · consultation seule
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
                          auteur {b.author} · porte sur le domaine {b.domainName}
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
          <b>Les syllabus sont rédigés par les formateurs</b> (console formateur), pas par l&apos;admin. Un formateur
          énonce l&apos;intention — titre, objectifs, acquis — et rattache un groupe ; ce rattachement permet au
          runtime + LLM de générer le parcours de chaque apprenant sur le DAG de concepts. Vous voyez le rattachement
          ici en <b>lecture seule</b> pour la gouvernance — il n&apos;y a ni création de syllabus ni édition de
          rattachement dans le plan de contrôle. Vos leviers sont les programmes, les groupes et les inscriptions.
        </span>
      </div>
    </div>
  );
}
