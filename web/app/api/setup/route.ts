import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { BACKEND_BASE, writeConfig } from "@/lib/config";
import { ensureUserAndMembership, mintToken } from "@/lib/auth/lore";
import { listCredentials, upsertCredential } from "@/lib/auth/store";
import { createSession } from "@/lib/auth/session";

export const runtime = "nodejs";

const MIN_PASSWORD = 10;

interface Body {
  orgName?: string;
  adminName?: string;
  adminEmail?: string;
  password?: string;
  confirmPassword?: string;
  bootstrapToken?: string;
}

// First-run setup CLAIMS the first admin — a privileged operation. It must prove
// operator authority with the bootstrap secret, otherwise anyone who reaches the
// app before initialization could take it over. Fails closed when
// LORE_BOOTSTRAP_TOKEN is unset.
function bootstrapOk(provided: string): boolean {
  const expected = process.env.LORE_BOOTSTRAP_TOKEN || "";
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// True once a TENANT_ADMIN credential exists — i.e. the system is initialized.
async function isInitialized(): Promise<boolean> {
  const creds = await listCredentials();
  return creds.some((c) => c.role === "TENANT_ADMIN" || c.role === "SUPER_ADMIN");
}

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base || "org";
}

// First-run setup: creates the tenant, the first admin user + TENANT_ADMIN
// membership + credential (a real password, no forced reset), persists the new
// tenant id into .gen/seed.json, mints a token, opens a session, returns /admin.
// Guarded against double-init: refuses if a TENANT_ADMIN already exists.
export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }

  // Require the operator bootstrap secret before any privileged action.
  if (!bootstrapOk(body.bootstrapToken || "")) {
    return NextResponse.json(
      { error: "a valid operator setup token is required" },
      { status: 401 }
    );
  }

  // Guard: never allow re-init once an admin exists.
  if (await isInitialized()) {
    return NextResponse.json({ error: "the system is already initialized" }, { status: 409 });
  }

  const orgName = (body.orgName || "").trim();
  const adminName = (body.adminName || "").trim();
  const adminEmail = (body.adminEmail || "").trim().toLowerCase();
  const password = body.password || "";
  const confirmPassword = body.confirmPassword || "";

  if (!orgName) return NextResponse.json({ error: "the organization name is required" }, { status: 400 });
  if (!adminName) return NextResponse.json({ error: "the admin name is required" }, { status: 400 });
  if (!adminEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(adminEmail)) {
    return NextResponse.json({ error: "a valid admin email is required" }, { status: 400 });
  }
  if (password.length < MIN_PASSWORD) {
    return NextResponse.json(
      { error: `the password must be at least ${MIN_PASSWORD} characters` },
      { status: 400 }
    );
  }
  if (password !== confirmPassword) {
    return NextResponse.json({ error: "the passwords do not match" }, { status: 400 });
  }

  // (1) create the tenant (open route).
  const slug = `${slugify(orgName)}-${Date.now().toString(36)}`;
  const tres = await fetch(`${BACKEND_BASE}/v1/tenants`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: orgName, slug }),
    cache: "no-store",
  });
  if (!tres.ok) {
    return NextResponse.json({ error: `could not create the organization (HTTP ${tres.status})` }, { status: 502 });
  }
  const tenant = (await tres.json()) as { id?: string; slug?: string };
  if (!tenant.id) {
    return NextResponse.json({ error: "the backend did not return a tenant id" }, { status: 502 });
  }
  const tenantId = String(tenant.id);

  // (2) create the admin user + TENANT_ADMIN membership.
  const provisioned = await ensureUserAndMembership(adminEmail, adminName, "TENANT_ADMIN", tenantId);
  if (!provisioned.ok) {
    return NextResponse.json({ error: provisioned.error }, { status: 502 });
  }

  // (3) store the admin credential with a REAL password (no forced reset).
  await upsertCredential({
    email: adminEmail,
    name: adminName,
    role: "TENANT_ADMIN",
    userId: provisioned.userId,
    tenantId,
    password,
  });

  // (4) persist the new tenant identity so seed()/lib/config picks it up.
  writeConfig({ tenantId, tenantSlug: tenant.slug || slug, tenantName: orgName });

  // (5) mint a token + open a session, land the operator on /admin.
  const token = await mintToken(tenantId, provisioned.userId);
  if (!token) {
    return NextResponse.json({ error: "could not establish a runtime session" }, { status: 502 });
  }
  await createSession({
    userId: provisioned.userId,
    tenantId,
    role: "TENANT_ADMIN",
    name: adminName,
    email: adminEmail,
    loreToken: token,
  });

  return NextResponse.json({ ok: true, redirect: "/admin" }, { status: 201 });
}
