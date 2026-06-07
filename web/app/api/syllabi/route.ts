import { NextResponse } from "next/server";
import { api, tpath } from "@/lib/api";
import type { Syllabus } from "@/lib/types";

interface Body {
  title: string;
  description: string;
  objectives?: Record<string, unknown>;
  outcomes?: Record<string, unknown>;
}

// POST: create a trainer-owned syllabus (intent only — title/description/objectives/outcomes).
export async function POST(req: Request) {
  const body = (await req.json()) as Body;
  const r = await api.post<Syllabus>(tpath("/syllabi"), body);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status || 502 });
  return NextResponse.json(r.data, { status: 201 });
}
