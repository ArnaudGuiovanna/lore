import { test, expect } from "@playwright/test";
import { login, USERS, PASSWORD } from "./helpers";

test.describe("Unauthenticated access", () => {
  test("GET /learner redirects to /login when signed out", async ({ page }) => {
    await page.goto("/learner");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("/login renders the sign-in form", async ({ page }) => {
    await page.goto("/login");
    // French sign-in form ("Se connecter").
    const form = page.getByRole("form", { name: /se connecter/i });
    await expect(form).toBeVisible();
    await expect(form.getByLabel(/e-mail professionnel/i)).toBeVisible();
    await expect(form.getByLabel(/mot de passe/i)).toBeVisible();
    await expect(form.getByRole("button", { name: /continuer/i })).toBeVisible();
  });
});

test.describe("Auth + RBAC", () => {
  test("admin signs in and lands on /admin with the management surface", async ({ page }) => {
    await login(page, USERS.admin.email);
    await expect(page).toHaveURL(/\/admin$/);
    // Control plane management surface is present (FR: "Plan de contrôle"),
    // asserted via a stable test id since the copy is now French.
    await expect(page.getByTestId("control-plane-kicker").first()).toBeVisible();
    await expect(page.getByRole("navigation", { name: /sections d'administration/i })).toBeVisible();
  });

  test("learner signs in and lands on /learner", async ({ page }) => {
    await login(page, USERS.learner.email);
    await expect(page).toHaveURL(/\/learner$/);
    // FR: "Apprenant · {name}" banner.
    await expect(page.getByTestId("learner-banner").first()).toBeVisible();
  });

  test("learner is blocked from /admin and redirected back to /learner (RBAC)", async ({ page }) => {
    await login(page, USERS.learner.email);
    await expect(page).toHaveURL(/\/learner$/);
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/learner$/);
  });

  test("wrong password shows an error and stays on /login", async ({ page }) => {
    await login(page, USERS.admin.email, "definitely-wrong-password");
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });
});
