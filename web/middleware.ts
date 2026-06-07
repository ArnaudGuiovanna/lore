import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

const COOKIE = "lore_session";

function secret(): Uint8Array {
  return new TextEncoder().encode(
    process.env.SESSION_SECRET || "dev-session-secret-change-me-please-32bytes-minimum"
  );
}

const roleHome: Record<string, string> = {
  LEARNER: "/learner",
  TRAINER: "/trainer",
  TENANT_ADMIN: "/admin",
  SUPER_ADMIN: "/admin",
};

// Which role each protected area requires.
function requiredRoles(pathname: string): string[] | null {
  if (pathname.startsWith("/learner")) return ["LEARNER"];
  if (pathname.startsWith("/trainer")) return ["TRAINER"];
  if (pathname.startsWith("/admin")) return ["TENANT_ADMIN", "SUPER_ADMIN"];
  return null;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const need = requiredRoles(pathname);
  if (!need) return NextResponse.next();

  const raw = req.cookies.get(COOKIE)?.value;
  if (!raw) return redirectTo("/login", req);

  try {
    const { payload } = await jwtVerify(raw, secret());
    const role = String(payload.role || "");
    if (!need.includes(role)) {
      // Authenticated but wrong area → send to the user's own home.
      return redirectTo(roleHome[role] || "/login", req);
    }
    return NextResponse.next();
  } catch {
    return redirectTo("/login", req);
  }
}

function redirectTo(path: string, req: NextRequest) {
  const url = req.nextUrl.clone();
  url.pathname = path;
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/learner/:path*", "/trainer/:path*", "/admin/:path*"],
};
