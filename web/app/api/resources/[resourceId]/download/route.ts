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
  const headers = new Headers();
  headers.set("Content-Type", upstream.headers.get("content-type") || "application/octet-stream");
  headers.set("X-Content-Type-Options", "nosniff");
  const disposition = upstream.headers.get("content-disposition");
  if (disposition) headers.set("Content-Disposition", disposition);
  return new Response(upstream.body, { status: 200, headers });
}
