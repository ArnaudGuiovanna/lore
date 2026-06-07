import { expect, type Page } from "@playwright/test";

// Seeded demo identities on the shared instance (demo logins enabled).
// Password is the seed default. These are read-mostly logins.
export const USERS = {
  admin: { email: "admin@acme.test", role: "TENANT_ADMIN", home: "/admin" },
  trainer: { email: "trainer@acme.test", role: "TRAINER", home: "/trainer" },
  learner: { email: "amara@acme.test", role: "LEARNER", home: "/learner" },
} as const;

export const PASSWORD = "lore123!";

/**
 * Log in through the real sign-in form and wait for the role landing route.
 * Drives the UI (not the API) so the auth + redirect path is exercised end to end.
 */
export async function login(
  page: Page,
  email: string,
  password: string = PASSWORD
): Promise<void> {
  await page.goto("/login");
  const form = page.getByRole("form", { name: /sign in/i });
  await form.getByLabel(/work email/i).fill(email);
  await form.getByLabel(/password/i).fill(password);
  await form.getByRole("button", { name: /continue/i }).click();
}
