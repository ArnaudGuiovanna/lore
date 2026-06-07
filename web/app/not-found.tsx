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
          Il n’y a rien sur ce chemin.
        </h1>
        <p className="soft" style={{ marginTop: 12, maxWidth: "54ch" }}>
          Le runtime décide de la suite — et ceci n’est pas l’une de ses routes. Revenez vers l’une
          des trois surfaces.
        </p>

        <div className="row" style={{ gap: 12, marginTop: 26, flexWrap: "wrap" }}>
          <Link className="btn primary" href="/">
            Accueil
          </Link>
          <Link className="btn ghost" href="/learner">
            Apprenant
          </Link>
          <Link className="btn ghost" href="/trainer">
            Formateur
          </Link>
          <Link className="btn ghost" href="/admin">
            Administrateur
          </Link>
        </div>
      </div>
    </div>
  );
}
