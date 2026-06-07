import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { sessionSecret as secret } from "@/lib/auth/secret";

const COOKIE = "lore_session";

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
  // Defense in depth: admin API routes (in addition to their per-route getSession gate).
  if (pathname.startsWith("/api/admin")) return ["TENANT_ADMIN", "SUPER_ADMIN"];
  return null;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const need = requiredRoles(pathname);
  if (!need) return NextResponse.next();
  const isApi = pathname.startsWith("/api/");

  const raw = req.cookies.get(COOKIE)?.value;
  if (!raw) return deny(req, isApi, 401, "/login");

  try {
    const { payload } = await jwtVerify(raw, secret());
    const role = String(payload.role || "");
    if (!need.includes(role)) {
      // Authenticated but wrong area → JSON 403 for APIs, else send to own home.
      return deny(req, isApi, 403, roleHome[role] || "/login");
    }
    return NextResponse.next();
  } catch {
    return deny(req, isApi, 401, "/login");
  }
}

// APIs get an honest JSON status; pages get a redirect.
function deny(req: NextRequest, isApi: boolean, status: number, path: string) {
  if (isApi) return NextResponse.json({ error: status === 401 ? "unauthorized" : "forbidden" }, { status });
  const url = req.nextUrl.clone();
  url.pathname = path;
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/learner/:path*", "/trainer/:path*", "/admin/:path*", "/api/admin/:path*"],
};
