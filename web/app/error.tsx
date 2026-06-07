"use client";

// Calm, honest LECTURE error panel. The most likely cause here is that the
// headless runtime (the Go backend) is unreachable — so we say that plainly
// rather than dressing it up.
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="wrap" style={{ maxWidth: 720, padding: "80px 24px 96px" }}>
      <div className="panel" style={{ padding: 32 }}>
        <span className="mark alarm">runtime unreachable</span>
        <h1 className="standfirst" style={{ marginTop: 18, maxWidth: "24ch" }}>
          The runtime didn’t answer.
        </h1>
        <p className="soft" style={{ marginTop: 12, maxWidth: "56ch" }}>
          This surface reads live, tenant-scoped state from the backend. The last request failed —
          the server may be down, restarting, or the seed may be missing. Nothing was lost; the
          runtime owns progression, and your evidence is durable.
        </p>

        {error?.digest ? (
          <p className="mono quiet" style={{ marginTop: 14, fontSize: 11 }}>
            ref {error.digest}
          </p>
        ) : null}

        <div className="row" style={{ gap: 12, marginTop: 26, flexWrap: "wrap" }}>
          <button type="button" className="btn primary" onClick={() => reset()}>
            Try again
          </button>
          <a className="btn ghost" href="/">
            Back to entry
          </a>
        </div>
      </div>
    </div>
  );
}
