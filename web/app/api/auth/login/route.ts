import { NextResponse } from "next/server";
import { verifyPassword } from "@/lib/auth/store";
import { mintToken } from "@/lib/auth/lore";
import { createSession, roleHome } from "@/lib/auth/session";
import { loginLockout, recordLoginFailure, recordLoginSuccess } from "@/lib/auth/login-rate-limit";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: { email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }
  const email = (body.email || "").trim();
  const password = body.password || "";
  if (!email || !password) {
    return NextResponse.json({ error: "email and password are required" }, { status: 400 });
  }

  const lockout = loginLockout(req, email);
  if (lockout.locked) {
    return NextResponse.json(
      { error: "too many failed login attempts; retry later" },
      { status: 429, headers: { "Retry-After": String(lockout.retryAfterSeconds) } }
    );
  }

  const cred = await verifyPassword(email, password);
  if (!cred) {
    recordLoginFailure(req, email);
    return NextResponse.json({ error: "invalid email or password" }, { status: 401 });
  }

  // Mint a real LORE bearer token (role/tenant derived from membership).
  const token = await mintToken(cred.tenantId, cred.userId);
  if (!token) {
    recordLoginFailure(req, email);
    return NextResponse.json({ error: "could not establish a runtime session" }, { status: 502 });
  }

  // Invited users (mustChangePassword) get a session, but it carries a mustChange
  // claim that confines them to /account/password until they set a real password.
  const mustChange = cred.mustChangePassword === true;

  await createSession({
    userId: cred.userId,
    tenantId: cred.tenantId,
    role: cred.role,
    name: cred.name,
    email: cred.email,
    loreToken: token,
    mustChange,
  });

  const redirect = mustChange ? "/account/password" : roleHome(cred.role);
  recordLoginSuccess(req, email);
  return NextResponse.json({ ok: true, role: cred.role, mustChange, redirect });
}
