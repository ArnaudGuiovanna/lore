import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { api, tpath } from "@/lib/api";
import type { Resource } from "@/lib/types";

// B-17 — ressources pédagogiques (staff) : liste + partage d'un fichier
// (base64, ≤ 20 Mio) ou d'un lien, ciblé cohorte ou tenant entier.
function staff(role?: string): boolean {
  return role === "TRAINER" || role === "TENANT_ADMIN" || role === "SUPER_ADMIN" || role === "GESTIONNAIRE";
}

// 20 Mio de binaire ≈ 27,9 Mio une fois encodé base64 (4/3 + padding).
const MAX_BASE64_CHARS = Math.ceil((20 * 1024 * 1024) / 3) * 4;

export async function GET() {
  const session = await getSession();
  if (!session || !staff(session.role)) {
    return NextResponse.json({ error: "réservé au personnel" }, { status: 403 });
  }
  const r = await api.get<Resource[]>(tpath("/resources"));
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status || 502 });
  return NextResponse.json(r.data ?? [], { status: 200 });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session || !staff(session.role)) {
    return NextResponse.json({ error: "réservé au personnel" }, { status: 403 });
  }
  const body = (await req.json()) as {
    title?: string;
    description?: string;
    kind?: string;
    cohort_id?: string;
    url?: string;
    file_name?: string;
    mime_type?: string;
    content_base64?: string;
  };
  if (!body.title?.trim()) return NextResponse.json({ error: "le titre est requis" }, { status: 400 });
  if (body.kind !== "FICHIER" && body.kind !== "LIEN") {
    return NextResponse.json({ error: "kind doit être FICHIER ou LIEN" }, { status: 400 });
  }
  if (body.kind === "LIEN" && !body.url?.trim()) {
    return NextResponse.json({ error: "une URL est requise pour un lien" }, { status: 400 });
  }
  if (body.kind === "FICHIER") {
    if (!body.content_base64) {
      return NextResponse.json({ error: "un fichier est requis" }, { status: 400 });
    }
    if (body.content_base64.length > MAX_BASE64_CHARS) {
      return NextResponse.json({ error: "fichier trop volumineux (maximum 20 Mio)" }, { status: 413 });
    }
  }
  const r = await api.post<Resource>(tpath("/resources"), {
    title: body.title.trim(),
    description: body.description || "",
    kind: body.kind,
    cohort_id: body.cohort_id || "",
    url: body.kind === "LIEN" ? body.url?.trim() : "",
    file_name: body.kind === "FICHIER" ? body.file_name || "" : "",
    mime_type: body.kind === "FICHIER" ? body.mime_type || "" : "",
    content_base64: body.kind === "FICHIER" ? body.content_base64 : "",
  });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status || 502 });
  return NextResponse.json(r.data, { status: 201 });
}
