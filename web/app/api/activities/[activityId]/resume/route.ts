import { NextResponse } from "next/server";
import { api, tpath } from "@/lib/api";
import type { Activity } from "@/lib/types";

// POST: close the open pause on a running activity (B-07).
export async function POST(_req: Request, { params }: { params: Promise<{ activityId: string }> }) {
  const { activityId } = await params;
  const r = await api.post<Activity>(tpath(`/activities/${activityId}/resume`), {});
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status || 502 });
  return NextResponse.json(r.data, { status: 200 });
}
