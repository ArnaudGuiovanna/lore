import "server-only";

const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1000;
const LOCKOUT_MS = 15 * 60 * 1000;

type Attempt = {
  failures: number;
  firstFailure: number;
  lockedUntil: number;
};

const attempts = new Map<string, Attempt>();

function clientIP(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip") || "unknown-ip";
}

function key(req: Request, email: string): string {
  return `${clientIP(req)}|${email.trim().toLowerCase() || "unknown-email"}`;
}

export function loginLockout(req: Request, email: string, now = Date.now()): { locked: false } | { locked: true; retryAfterSeconds: number } {
  const attempt = attempts.get(key(req, email));
  if (!attempt) return { locked: false };
  if (attempt.lockedUntil > now) {
    return { locked: true, retryAfterSeconds: Math.max(1, Math.ceil((attempt.lockedUntil - now) / 1000)) };
  }
  if (now - attempt.firstFailure > WINDOW_MS) {
    attempts.delete(key(req, email));
  }
  return { locked: false };
}

export function recordLoginFailure(req: Request, email: string, now = Date.now()): void {
  const k = key(req, email);
  let attempt = attempts.get(k);
  if (!attempt || now - attempt.firstFailure > WINDOW_MS) {
    attempt = { failures: 0, firstFailure: now, lockedUntil: 0 };
  }
  attempt.failures += 1;
  if (attempt.failures >= MAX_FAILURES) {
    attempt.lockedUntil = now + LOCKOUT_MS;
  }
  attempts.set(k, attempt);
}

export function recordLoginSuccess(req: Request, email: string): void {
  attempts.delete(key(req, email));
}
