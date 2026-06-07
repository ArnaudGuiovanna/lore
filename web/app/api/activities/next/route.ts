import { NextResponse } from "next/server";
import { api, tpath } from "@/lib/api";
import type { PlanNextResponse } from "@/lib/types";

interface Body {
  learnerId: string;
  domainId: string;
}

// POST {learnerId, domainId}: ask the runtime to plan the next activity.
// The runtime owns progression; this only relays its decision.
export async function POST(req: Request) {
  const { learnerId, domainId } = (await req.json()) as Body;
  const r = await api.post<PlanNextResponse>(
    tpath(`/learners/${learnerId}/activities/next`),
    { domain_id: domainId }
  );
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status || 502 });
  return NextResponse.json(r.data, { status: 200 });
}
