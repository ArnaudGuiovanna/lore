// Signed, httpOnly session cookie holding the authenticated identity + the LORE
// bearer token used for backend calls. Server-only.
import "server-only";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import type { Role } from "@/lib/types";

const COOKIE = "lore_session";
const TTL_SECONDS = 60 * 60 * 12; // 12h (the backend caps LORE tokens at 24h)

export interface Session {
  userId: string;
  tenantId: string;
  role: Role;
  name: string;
  email: string;
  loreToken: string; // bearer for the LORE backend (role/tenant scoped)
}

function secret(): Uint8Array {
  const s = process.env.SESSION_SECRET || "dev-session-secret-change-me-please-32bytes-minimum";
  return new TextEncoder().encode(s);
}

export async function createSession(s: Session): Promise<void> {
  const token = await new SignJWT({ ...s })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${TTL_SECONDS}s`)
    .sign(secret());
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: TTL_SECONDS,
  });
}

export async function getSession(): Promise<Session | null> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return null;
  try {
    const { payload } = await jwtVerify(raw, secret());
    if (!payload.userId || !payload.tenantId || !payload.role || !payload.loreToken) return null;
    return {
      userId: String(payload.userId),
      tenantId: String(payload.tenantId),
      role: payload.role as Role,
      name: String(payload.name || ""),
      email: String(payload.email || ""),
      loreToken: String(payload.loreToken),
    };
  } catch {
    return null;
  }
}

export async function destroySession(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

// Where each role lands after login.
export function roleHome(role: Role): string {
  switch (role) {
    case "LEARNER": return "/learner";
    case "TRAINER": return "/trainer";
    case "TENANT_ADMIN":
    case "SUPER_ADMIN": return "/admin";
    default: return "/";
  }
}
