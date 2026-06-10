import { AssignmentsBoard } from "@/components/learner/AssignmentsBoard";

export const dynamic = "force-dynamic";

// B-26 — « Devoirs » : the learner's assignments with due date, status
// (à rendre / rendu / noté) and a hand-in box. Reads + writes go through
// /api/learner/assignments (session-scoped) — the page itself is a thin shell.
export default function AssignmentsScreen() {
  return (
    <div className="col" style={{ gap: 22 }}>
      <div className="col" style={{ gap: 8 }}>
        <span className="kicker">Devoirs</span>
        <h1 className="standfirst" data-testid="assignments-title">
          Vos devoirs — rendus, échéances et notes.
        </h1>
        <p className="soft" style={{ maxWidth: "62ch", fontSize: 14, lineHeight: 1.6 }}>
          Les devoirs sont créés par votre formateur. Vous pouvez modifier votre rendu tant
          qu&apos;il n&apos;est pas noté ; une fois corrigé, la note et le feedback s&apos;affichent ici.
        </p>
      </div>
      <AssignmentsBoard />
    </div>
  );
}
