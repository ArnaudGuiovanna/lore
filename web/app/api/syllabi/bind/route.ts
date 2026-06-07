import { NextResponse } from "next/server";
import { api, tpath } from "@/lib/api";
import type { SyllabusBinding } from "@/lib/types";

interface Body {
  syllabusId: string;
  target_type: string;
  target_id: string;
  adaptation_mode: string;
}

// POST {syllabusId, target_type, target_id, adaptation_mode}: attach a syllabus to
// a cohort (binding). The runtime + LLM then generate the parcours from the binding.
export async function POST(req: Request) {
  const { syllabusId, ...binding } = (await req.json()) as Body;
  const r = await api.post<SyllabusBinding>(
    tpath(`/syllabi/${syllabusId}/bindings`),
    binding
  );
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status || 502 });
  return NextResponse.json(r.data, { status: 201 });
}
