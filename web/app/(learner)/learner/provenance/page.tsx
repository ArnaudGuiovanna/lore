import Link from "next/link";
import { seed } from "@/lib/config";
import { Mark, Pill } from "@/components/Mark";
import {
  activeLearner,
  conceptName,
  focusState,
  loadDomainGraph,
  loadStates,
} from "@/components/learner/data";
import { LearnerError } from "@/components/learner/LearnerStatus";
import { buildLineage, prerequisites } from "@/components/learner/lineage";

export const dynamic = "force-dynamic";

export default async function ProvenanceScreen() {
  const s = seed();
  const learner = await activeLearner();
  const [statesRes, graphRes] = await Promise.all([
    loadStates(learner.id),
    loadDomainGraph(s.domainId),
  ]);

  // The lineage is built from the domain graph; without it we can't honestly
  // draw where the parcours comes from.
  if (!graphRes.ok) {
    return (
      <div className="col" style={{ gap: 24 }}>
        <div className="col" style={{ gap: 8 }}>
          <span className="kicker">Why this path?</span>
          <h1 className="standfirst">Where your parcours comes from.</h1>
        </div>
        <LearnerError
          detail="We couldn't reach the runtime to read the domain graph, so we can't trace your lineage right now. Only your trainer can change this path — and it's safe."
          message={graphRes.error}
        />
      </div>
    );
  }

  const states = statesRes.ok ? statesRes.data : [];
  const graph = graphRes.data;
  const focus = focusState(states);
  const conceptId = focus?.concept_id ?? graph.concepts[0]?.id ?? "persistence";

  const nodes = buildLineage({
    cohortName: s.cohortName,
    syllabusId: s.syllabusId,
    conceptId,
    concepts: graph.concepts,
    dependencies: graph.dependencies,
  });

  const gates = prerequisites(graph.dependencies, conceptId).map((id) => ({
    id,
    name: conceptName(graph.concepts, id),
    mastered: (states.find((x) => x.concept_id === id)?.mastery ?? 0) >= 0.8,
  }));

  return (
    <div className="col" style={{ gap: 24 }}>
      <div className="col" style={{ gap: 8 }}>
        <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
          <span className="kicker">Why this path?</span>
          <Pill on>read-only</Pill>
        </div>
        <h1 className="standfirst">Where your parcours comes from.</h1>
        <p className="soft" style={{ maxWidth: "62ch", fontSize: 15, lineHeight: 1.6 }}>
          Your path is generated from the syllabus bound to your cohort. You can see
          this lineage — only your trainer can change it.
        </p>
      </div>

      <section className="panel" aria-label="Lineage">
        <ol className="col" style={{ gap: 0, listStyle: "none", margin: 0, padding: 0 }}>
          {nodes.map((n, i) => (
            <li
              key={n.id}
              className="col"
              style={{
                gap: 4,
                padding: "14px 0 14px 22px",
                borderLeft: "2px solid var(--line-2)",
                marginLeft: 6,
                position: "relative",
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  position: "absolute",
                  left: -7,
                  top: 18,
                  width: 12,
                  height: 12,
                  borderRadius: "50%",
                  background: n.kind === "binding" ? "var(--accent)" : "var(--paper)",
                  border: "2px solid var(--accent)",
                }}
              />
              <div className="spread" style={{ gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
                <strong style={{ fontSize: 16 }}>{n.label}</strong>
                <span className="mono quiet" style={{ fontSize: 10, letterSpacing: "0.1em" }}>
                  {n.kind === "binding" ? "real binding" : "provenance trace"}
                </span>
              </div>
              {n.detail ? (
                <span className="soft" style={{ fontSize: 13, lineHeight: 1.55 }}>
                  {n.detail}
                </span>
              ) : null}
              {n.id === "runtime" ? (
                <span style={{ marginTop: 4 }}>
                  <Mark source="runtime" />
                </span>
              ) : null}
              {n.id === "content" ? (
                <span style={{ marginTop: 4 }}>
                  <Mark source="fallbk" />
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      </section>

      {gates.length ? (
        <section className="panel col" style={{ gap: 12 }}>
          <span className="kicker">Prerequisites on the graph</span>
          <p className="soft" style={{ fontSize: 13 }}>
            The runtime added these gates from the concept DAG — “{conceptName(graph.concepts, conceptId)}”
            depends on them.
          </p>
          <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
            {gates.map((g) => (
              <Pill key={g.id} on={g.mastered}>
                {g.name} {g.mastered ? "✓" : "· locked"}
              </Pill>
            ))}
          </div>
        </section>
      ) : null}

      <footer
        className="col"
        style={{ gap: 6, borderTop: "1px solid var(--line)", paddingTop: 16 }}
      >
        <p className="soft" style={{ fontSize: 13, lineHeight: 1.6 }}>
          A syllabus is never edited in place. A trainer revision <strong>forks a new version</strong> and
          <strong> rebinds</strong> the cohort; your state — mastery, reviews, snapshots — is preserved while
          the runtime re-plans.
        </p>
        <Link
          href="/learner"
          className="mono"
          style={{ fontSize: 12, color: "var(--accent)", textDecoration: "none" }}
        >
          ← back to Now
        </Link>
      </footer>
    </div>
  );
}
