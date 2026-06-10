import { NextResponse } from "next/server";
import { BACKEND_BASE } from "@/lib/config";
import { getByEmail, upsertCredential } from "@/lib/auth/store";
import type { InviteLookup } from "@/lib/types";

// B-23 — PUBLIC self-enrollment endpoint (no session). Flow:
//   1) re-lookup the invite code server-side (never trust the page's claim),
//   2) refuse e-mails that already hold local credentials,
//   3) create the LORE user (open route),
//   4) redeem the invite with the operator bootstrap secret (trusted web tier:
//      the backend grants the LEARNER membership + cohort enrollment),
//   5) store the local credential with the password the user CHOSE (no forced
//      reset — this is not a temp password).
// The client then sends the new learner to /login.

interface Body {
  code?: string;
  name?: string;
  email?: string;
  password?: string;
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// --- naive in-memory rate limit (per IP) — enough to blunt code bruteforce on
// a single node; the invite code itself is a 128-bit secret.
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 10;
const hits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const fresh = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (fresh.length >= MAX_PER_WINDOW) {
    hits.set(ip, fresh);
    return true;
  }
  fresh.push(now);
  hits.set(ip, fresh);
  // opportunistic cleanup so the map cannot grow without bound
  if (hits.size > 1000) {
    for (const [k, v] of hits) {
      if (v.every((t) => now - t >= WINDOW_MS)) hits.delete(k);
    }
  }
  return false;
}

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "local";
}

async function jsonOrNull(res: Response): Promise<Record<string, unknown> | null> {
  const t = await res.text();
  try {
    return t ? (JSON.parse(t) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  if (rateLimited(clientIp(req))) {
    return NextResponse.json(
      { error: "Trop de tentatives — patientez une minute avant de réessayer." },
      { status: 429 }
    );
  }

  const body = (await req.json().catch(() => ({}))) as Body;
  const code = (body.code || "").trim();
  const name = (body.name || "").trim();
  const email = (body.email || "").trim().toLowerCase();
  const password = body.password || "";

  if (!code) return NextResponse.json({ error: "code d'invitation requis" }, { status: 400 });
  if (!name) return NextResponse.json({ error: "le nom est requis" }, { status: 400 });
  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "un e-mail valide est requis" }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json(
      { error: "le mot de passe doit contenir au moins 8 caractères" },
      { status: 400 }
    );
  }

  // (a) re-lookup the code server-side; refuse anything not currently usable.
  let invite: InviteLookup;
  try {
    const res = await fetch(`${BACKEND_BASE}/v1/invites/${encodeURIComponent(code)}`, { cache: "no-store" });
    if (!res.ok) {
      return NextResponse.json({ error: "invitation introuvable ou invalide" }, { status: 404 });
    }
    invite = (await res.json()) as InviteLookup;
  } catch {
    return NextResponse.json({ error: "le backend est injoignable" }, { status: 502 });
  }
  if (!invite.usable) {
    return NextResponse.json(
      { error: invite.reason || "cette invitation ne peut plus être utilisée" },
      { status: 400 }
    );
  }

  // (b) a local credential already exists for this e-mail → sign in instead.
  if (await getByEmail(email)) {
    return NextResponse.json(
      { error: "Un compte existe déjà avec cet e-mail — connectez-vous." },
      { status: 409 }
    );
  }

  // The redemption needs the operator bootstrap secret (trusted web tier).
  const boot = process.env.LORE_BOOTSTRAP_TOKEN || "";
  if (!boot) {
    return NextResponse.json(
      { error: "L'auto-inscription est indisponible : le serveur n'est pas configuré (LORE_BOOTSTRAP_TOKEN absent)." },
      { status: 503 }
    );
  }

  // (c) create the LORE user (open route).
  const ures = await fetch(`${BACKEND_BASE}/v1/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, name }),
    cache: "no-store",
  });
  const udata = await jsonOrNull(ures);
  if (!ures.ok || !udata?.id) {
    const msg =
      ures.status === 409
        ? "Un compte existe déjà avec cet e-mail — connectez-vous."
        : String(udata?.error || `création du compte impossible (HTTP ${ures.status})`);
    return NextResponse.json({ error: msg }, { status: ures.status === 409 ? 409 : 502 });
  }
  const userId = String(udata.id);

  // (d) redeem: the backend grants LEARNER membership + cohort enrollment and
  // burns one use of the code.
  const rres = await fetch(`${BACKEND_BASE}/v1/invites/${encodeURIComponent(code)}/redeem`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-LORE-Bootstrap-Token": boot },
    body: JSON.stringify({ user_id: userId }),
    cache: "no-store",
  });
  if (!rres.ok) {
    const rdata = await jsonOrNull(rres);
    return NextResponse.json(
      { error: String(rdata?.error || `l'invitation n'a pas pu être utilisée (HTTP ${rres.status})`) },
      { status: 502 }
    );
  }

  // (e) local credential with the user's own password — no forced reset.
  await upsertCredential({
    email,
    name,
    role: "LEARNER",
    userId,
    tenantId: invite.tenant_id,
    password,
  });

  return NextResponse.json(
    { userId, email, tenantId: invite.tenant_id, cohortId: invite.cohort_id },
    { status: 201 }
  );
}
