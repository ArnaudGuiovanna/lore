import { NextResponse } from "next/server";
import { verifyPassword } from "@/lib/auth/store";
import { mintToken } from "@/lib/auth/lore";
import { createSession, roleHome } from "@/lib/auth/session";

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

  const cred = verifyPassword(email, password);
  if (!cred) {
    return NextResponse.json({ error: "invalid email or password" }, { status: 401 });
  }

  // Mint a real LORE bearer token (role/tenant derived from membership).
  const token = await mintToken(cred.tenantId, cred.userId);
  if (!token) {
    return NextResponse.json({ error: "could not establish a runtime session" }, { status: 502 });
  }

  await createSession({
    userId: cred.userId,
    tenantId: cred.tenantId,
    role: cred.role,
    name: cred.name,
    email: cred.email,
    loreToken: token,
  });

  return NextResponse.json({ ok: true, role: cred.role, redirect: roleHome(cred.role) });
}
