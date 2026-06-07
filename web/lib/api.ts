// Typed server-side fetch client for the LORE backend (headless LMS).
// All calls run on the server (Server Components / Route Handlers). The browser never
// talks to the backend directly. Tenant-scoped helpers use the seeded tenant id.
import "server-only";
import { BACKEND_BASE, seed } from "./config";
import { getSession } from "./auth/session";

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

type Options = {
  idempotencyKey?: string;
  // disable Next.js fetch cache by default (runtime data is dynamic)
  revalidate?: number | false;
  signal?: AbortSignal;
};

async function call<T>(method: string, path: string, body?: unknown, opts: Options = {}): Promise<ApiResult<T>> {
  const url = path.startsWith("http") ? path : `${BACKEND_BASE}${path}`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
  // Attach the authenticated user's LORE bearer token on tenant-scoped routes,
  // so the backend enforces role/tenant access (real RBAC end-to-end).
  if (path.includes("/v1/tenants/")) {
    const session = await getSession();
    if (session?.loreToken) headers["Authorization"] = `Bearer ${session.loreToken}`;
  }
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      next: opts.revalidate === undefined ? undefined : { revalidate: opts.revalidate },
      signal: opts.signal,
    });
    const text = await res.text();
    let parsed: unknown = undefined;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    if (!res.ok) {
      let error = `HTTP ${res.status}`;
      if (parsed && typeof parsed === "object" && "error" in parsed) {
        error = String((parsed as Record<string, unknown>).error);
      } else if (typeof parsed === "string" && parsed.trim()) {
        error = parsed;
      }
      return { ok: false, status: res.status, error };
    }
    return { ok: true, data: parsed as T };
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error ? e.message : "network error" };
  }
}

export const api = {
  get: <T>(path: string, opts?: Options) => call<T>("GET", path, undefined, opts),
  post: <T>(path: string, body?: unknown, opts?: Options) => call<T>("POST", path, body, opts),
  put: <T>(path: string, body?: unknown, opts?: Options) => call<T>("PUT", path, body, opts),
  patch: <T>(path: string, body?: unknown, opts?: Options) => call<T>("PATCH", path, body, opts),
};

// Tenant-scoped path builder using the active (seeded) tenant.
export function tpath(suffix: string): string {
  const { tenantId } = seed();
  return `/v1/tenants/${tenantId}${suffix.startsWith("/") ? suffix : `/${suffix}`}`;
}

// Health probe (used by the foundation page to show backend connectivity).
export async function health(): Promise<boolean> {
  const r = await api.get<{ status: string }>("/health");
  return r.ok && r.data?.status === "ok";
}
