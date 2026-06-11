import Link from "next/link";
import { activeLearner, getReviewsDue, getStates } from "@/components/learner/data";
import { loadTenantContext } from "@/lib/tenant-context";
import { BOUND_SYLLABUS_TITLE } from "@/components/learner/lineage";

// The modeline (tmux/vim register): the whole state of the world in one quiet
// mono line at the bottom edge. Segments are CONDITIONAL — a learner who is up
// to date sees only the syllabus anchor. Calm is the default state.
export async function StatusLine() {
  let syllabus = BOUND_SYLLABUS_TITLE;
  let mastery: number | null = null;
  let due = 0;
  try {
    const learner = await activeLearner();
    const [ctx, states, reviews] = await Promise.all([
      loadTenantContext(),
      getStates(learner.id).catch(() => []),
      getReviewsDue(learner.id).catch(() => []),
    ]);
    syllabus = ctx.primarySyllabus?.title || BOUND_SYLLABUS_TITLE;
    if (states.length) {
      mastery = states.reduce((acc, s) => acc + (s.mastery || 0), 0) / states.length;
    }
    due = reviews.length;
  } catch {
    /* the statusline never blocks the screen — it degrades to the anchor */
  }

  const seg: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "0 12px",
    height: "100%",
    borderRight: "1px solid var(--line)",
    textDecoration: "none",
    whiteSpace: "nowrap",
  };

  return (
    <footer
      className="mono"
      aria-label="État du parcours"
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        height: 28,
        zIndex: 30,
        display: "flex",
        alignItems: "stretch",
        borderTop: "1px solid var(--line)",
        background: "var(--paper)",
        fontSize: 11,
        color: "var(--quiet)",
        overflow: "hidden",
      }}
    >
      <Link href="/learner/path" style={seg} className="quiet" data-testid="now-syllabus-line" title="votre syllabus">
        <span style={{ width: 5, height: 5, borderRadius: 1, background: "var(--accent)" }} aria-hidden="true" />
        syllabus · {syllabus}
      </Link>
      {mastery !== null ? (
        <Link href="/learner/progress" style={seg} className="quiet" title="progression par concept" data-testid="statusline-mastery">
          maîtrise {(mastery * 100).toFixed(0)}%
        </Link>
      ) : null}
      {due > 0 ? (
        <Link href="/learner/reviews" style={seg} className="quiet" title="rappels espacés dus">
          ↻ {due} rappel{due > 1 ? "s" : ""}
        </Link>
      ) : null}
    </footer>
  );
}
