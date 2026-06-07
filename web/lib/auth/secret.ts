// Session-cookie signing secret. Fails CLOSED — there is no insecure fallback:
// a missing/weak SESSION_SECRET would let anyone forge a session cookie (auth
// bypass), so we throw instead. Importable by both server-only modules and the
// (edge) middleware. The check runs at call time so `next build` never evaluates
// it without the env present.
export function sessionSecret(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) {
    throw new Error(
      "SESSION_SECRET must be set to a strong value (>= 32 characters). " +
        "Generate one with `openssl rand -hex 32` and set it in the environment."
    );
  }
  return new TextEncoder().encode(s);
}
