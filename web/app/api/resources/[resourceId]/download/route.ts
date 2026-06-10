import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { BACKEND_BASE } from "@/lib/config";

// B-17 — téléchargement d'une ressource : proxy brut (pas de parse JSON).
// FICHIER → les octets sont streamés avec leur type MIME ; LIEN → le 302 du
// backend est relayé au navigateur. Le backend applique le périmètre (un
// apprenant ne télécharge que ce que son jeton voit).
export async function GET(_req: Request, { params }: { params: Promise<{ resourceId: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "authentification requise" }, { status: 401 });
  }
  const { resourceId } = await params;
  const url = `${BACKEND_BASE}/v1/tenants/${encodeURIComponent(session.tenantId)}/resources/${encodeURIComponent(
    resourceId
  )}/download`;
  const upstream = await fetch(url, {
    headers: { Authorization: `Bearer ${session.loreToken}` },
    cache: "no-store",
    redirect: "manual",
  });

  // LIEN : le backend répond 302 vers l'URL externe — on relaie tel quel.
  if (upstream.status >= 300 && upstream.status < 400) {
    const location = upstream.headers.get("location");
    if (!location) return NextResponse.json({ error: "redirection sans destination" }, { status: 502 });
    return NextResponse.redirect(location, 302);
  }

  if (!upstream.ok) {
    const text = await upstream.text();
    let error = `HTTP ${upstream.status}`;
    try {
      const parsed = JSON.parse(text) as { error?: string };
      if (parsed?.error) error = parsed.error;
    } catch {
      if (text.trim()) error = text;
    }
    return NextResponse.json({ error }, { status: upstream.status });
  }

  // FICHIER : on streame les octets sans les recharger en mémoire.
  // Anti-XSS stocké : le type MIME vient du formateur, donc un HTML/SVG servi
  // same-origin exécuterait du script avec le cookie de session. On force les
  // types actifs en octet-stream, on impose attachment et un CSP sandbox.
  const headers = new Headers();
  const rawType = upstream.headers.get("content-type") || "application/octet-stream";
  const activeContent = /^(text\/html|application\/xhtml|image\/svg|application\/xml|text\/xml|application\/javascript|text\/javascript)/i.test(
    rawType
  );
  headers.set("Content-Type", activeContent ? "application/octet-stream" : rawType);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Content-Security-Policy", "sandbox; default-src 'none'");
  const disposition = upstream.headers.get("content-disposition");
  headers.set(
    "Content-Disposition",
    disposition && /attachment/i.test(disposition) ? disposition : `attachment; filename="ressource-${resourceId}"`
  );
  return new Response(upstream.body, { status: 200, headers });
}
