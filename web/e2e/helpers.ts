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
  // UI is French by default: the sign-in form is "Se connecter", with labels
  // "E-mail professionnel" / "Mot de passe" and a "Continuer" button.
  const form = page.getByRole("form", { name: /se connecter/i });
  await form.getByLabel(/e-mail professionnel/i).fill(email);
  await form.getByLabel(/mot de passe/i).fill(password);
  await form.getByRole("button", { name: /continuer/i }).click();
}
