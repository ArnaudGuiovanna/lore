import { NextResponse } from "next/server";
import { api, tpath } from "@/lib/api";
import type { Alert } from "@/lib/types";

// PATCH /api/alerts/{id}: update an alert (e.g. status -> acknowledged/resolved).
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json()) as Partial<Pick<Alert, "status">> & Record<string, unknown>;
  const r = await api.patch<Alert>(tpath(`/alerts/${id}`), body);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status || 502 });
  return NextResponse.json(r.data, { status: 200 });
}
