import { NextResponse } from "next/server";
import { api, tpath } from "@/lib/api";
import type { Activity } from "@/lib/types";

// POST: pause the running activity so idle time is excluded from training time
// (B-07). Idempotent on the backend — pausing twice keeps the original pause.
export async function POST(_req: Request, { params }: { params: Promise<{ activityId: string }> }) {
  const { activityId } = await params;
  const r = await api.post<Activity>(tpath(`/activities/${activityId}/pause`), {});
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status || 502 });
  return NextResponse.json(r.data, { status: 200 });
}
