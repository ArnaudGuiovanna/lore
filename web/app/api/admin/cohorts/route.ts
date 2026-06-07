import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { api, tpath } from "@/lib/api";
import type { Cohort } from "@/lib/types";

interface Body {
  program_id?: string;
  name?: string;
  start_date?: string;
  end_date?: string;
}

// POST: create a cohort under a program in the acting admin's tenant.
// Backend: POST /v1/tenants/{t}/cohorts {program_id,name,start_date,end_date}
//   -> emits CohortCreated. Dates are required by the backend (parseDate).
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  if (session.role !== "TENANT_ADMIN" && session.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "only an administrator may create cohorts" }, { status: 403 });
  }

  const body = (await req.json()) as Body;
  const programId = (body.program_id || "").trim();
  const name = (body.name || "").trim();
  if (!programId) return NextResponse.json({ error: "a program is required" }, { status: 400 });
  if (!name) return NextResponse.json({ error: "a cohort name is required" }, { status: 400 });
  if (!body.start_date || !body.end_date) {
    return NextResponse.json({ error: "start and end dates are required" }, { status: 400 });
  }

  const r = await api.post<Cohort>(tpath("/cohorts"), {
    program_id: programId,
    name,
    start_date: body.start_date,
    end_date: body.end_date,
  });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status || 502 });
  return NextResponse.json(r.data, { status: 201 });
}
