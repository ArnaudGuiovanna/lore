import { NextResponse } from "next/server";
import { api, tpath } from "@/lib/api";
import type { LLMConfiguration } from "@/lib/types";

interface Body {
  scope_type?: string;
  scope_id?: string;
  [k: string]: unknown;
}

// PUT {scope_type?, scope_id?, ...config}: upsert an LLM configuration. Scope is
// passed as query params; the remaining body is the configuration payload.
export async function PUT(req: Request) {
  const { scope_type, scope_id, ...config } = (await req.json()) as Body;
  const qs = new URLSearchParams();
  if (scope_type) qs.set("scope_type", scope_type);
  if (scope_id) qs.set("scope_id", scope_id);
  const query = qs.toString();
  const r = await api.put<LLMConfiguration>(
    tpath(`/llm-configurations${query ? `?${query}` : ""}`),
    config
  );
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status || 502 });
  return NextResponse.json(r.data, { status: 200 });
}
