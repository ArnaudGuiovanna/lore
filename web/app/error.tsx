"use client";

// Calm, honest LECTURE error panel. The most likely cause here is that the
// headless runtime (the Go backend) is unreachable — so we say that plainly
// rather than dressing it up.
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="wrap" style={{ maxWidth: 720, padding: "80px 24px 96px" }}>
      <div className="panel" style={{ padding: 32 }}>
        <span className="mark alarm">runtime injoignable</span>
        <h1 className="standfirst" style={{ marginTop: 18, maxWidth: "24ch" }}>
          Le runtime n’a pas répondu.
        </h1>
        <p className="soft" style={{ marginTop: 12, maxWidth: "56ch" }}>
          Cette surface lit l’état en direct, limité au tenant, depuis le backend. La dernière requête a
          échoué — le serveur est peut-être arrêté, en redémarrage, ou les données initiales manquent. Rien
          n’est perdu ; le runtime pilote la progression et vos preuves sont durables.
        </p>

        {error?.digest ? (
          <p className="mono quiet" style={{ marginTop: 14, fontSize: 11 }}>
            ref {error.digest}
          </p>
        ) : null}

        <div className="row" style={{ gap: 12, marginTop: 26, flexWrap: "wrap" }}>
          <button type="button" className="btn primary" onClick={() => reset()}>
            Réessayer
          </button>
          <a className="btn ghost" href="/">
            Retour à l’accueil
          </a>
        </div>
      </div>
    </div>
  );
}
