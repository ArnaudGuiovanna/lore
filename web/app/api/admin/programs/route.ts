import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { api, tpath } from "@/lib/api";
import type { Program } from "@/lib/types";

interface Body {
  name?: string;
}

// POST: create a program in the acting admin's tenant.
// Backend: POST /v1/tenants/{t}/programs {name} -> emits ProgramCreated.
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  if (session.role !== "TENANT_ADMIN" && session.role !== "SUPER_ADMIN" && session.role !== "GESTIONNAIRE") {
    return NextResponse.json({ error: "only an administrator may create programs" }, { status: 403 });
  }

  const body = (await req.json()) as Body;
  const name = (body.name || "").trim();
  if (!name) return NextResponse.json({ error: "a program name is required" }, { status: 400 });

  const r = await api.post<Program>(tpath("/programs"), { name });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status || 502 });
  return NextResponse.json(r.data, { status: 201 });
}
