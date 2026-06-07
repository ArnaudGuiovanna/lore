import { NextResponse } from "next/server";
import { getSession, createSession, roleHome } from "@/lib/auth/session";
import { verifyPassword, setPassword, setMustChangePassword } from "@/lib/auth/store";

export const runtime = "nodejs";

const MIN_LENGTH = 10;

interface Body {
  currentPassword?: string;
  newPassword?: string;
  confirmPassword?: string;
}

// Change the signed-in user's password. Two modes:
//   - FORCED RESET (session.mustChange): no current password required; setting a
//     new password clears the mustChange flag and re-mints the session.
//   - SELF-SERVICE (any logged-in user): the current password MUST be supplied and
//     verified before the change is applied.
// On success the session is re-minted (mustChange cleared) and the role home is
// returned so the client can redirect.
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }

  const newPassword = body.newPassword || "";
  const confirmPassword = body.confirmPassword || "";

  if (newPassword.length < MIN_LENGTH) {
    return NextResponse.json(
      { error: `the new password must be at least ${MIN_LENGTH} characters` },
      { status: 400 }
    );
  }
  if (confirmPassword !== newPassword) {
    return NextResponse.json({ error: "the passwords do not match" }, { status: 400 });
  }

  const forced = session.mustChange === true;

  // Self-service (not a forced reset) requires verifying the current password.
  if (!forced) {
    const current = body.currentPassword || "";
    if (!current) {
      return NextResponse.json({ error: "your current password is required" }, { status: 400 });
    }
    const ok = await verifyPassword(session.email, current);
    if (!ok) {
      return NextResponse.json({ error: "your current password is incorrect" }, { status: 401 });
    }
    if (current === newPassword) {
      return NextResponse.json(
        { error: "the new password must be different from the current one" },
        { status: 400 }
      );
    }
  }

  const set = await setPassword(session.email, newPassword);
  if (!set) {
    return NextResponse.json({ error: "could not update the password" }, { status: 500 });
  }
  await setMustChangePassword(session.email, false);

  // Re-mint the session with mustChange cleared (keep the same LORE bearer token).
  await createSession({
    userId: session.userId,
    tenantId: session.tenantId,
    role: session.role,
    name: session.name,
    email: session.email,
    loreToken: session.loreToken,
    mustChange: false,
  });

  return NextResponse.json({ ok: true, redirect: roleHome(session.role) });
}
