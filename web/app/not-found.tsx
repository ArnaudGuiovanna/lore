import Link from "next/link";

// Calm LECTURE 404 — quiet, on-brand, no theatrics.
export default function NotFound() {
  return (
    <div className="wrap" style={{ maxWidth: 720, padding: "80px 24px 96px" }}>
      <div className="panel" style={{ padding: 32 }}>
        <span className="mono quiet" style={{ fontSize: 11, letterSpacing: "0.18em" }}>
          404
        </span>
        <h1 className="standfirst" style={{ marginTop: 16, maxWidth: "26ch" }}>
          There’s nothing on this path.
        </h1>
        <p className="soft" style={{ marginTop: 12, maxWidth: "54ch" }}>
          The runtime decides what comes next — and this isn’t one of its routes. Head back to one
          of the three surfaces.
        </p>

        <div className="row" style={{ gap: 12, marginTop: 26, flexWrap: "wrap" }}>
          <Link className="btn primary" href="/">
            Entry
          </Link>
          <Link className="btn ghost" href="/learner">
            Learner
          </Link>
          <Link className="btn ghost" href="/trainer">
            Trainer
          </Link>
          <Link className="btn ghost" href="/admin">
            Admin
          </Link>
        </div>
      </div>
    </div>
  );
}
