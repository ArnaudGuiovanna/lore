import { NextResponse } from "next/server";
import { api, tpath } from "@/lib/api";
import type { Activity } from "@/lib/types";

// POST: mark the planned activity as started so training time (B-07) has a
// real start boundary. Called by the workbench right after planning.
export async function POST(_req: Request, { params }: { params: Promise<{ activityId: string }> }) {
  const { activityId } = await params;
  const r = await api.post<Activity>(tpath(`/activities/${activityId}/start`), {});
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status || 502 });
  return NextResponse.json(r.data, { status: 200 });
}
