import { test, expect } from "@playwright/test";
import { login, USERS } from "./helpers";

// B-23 — full self-enrollment journey: the admin mints an invitation link in
// the console, an anonymous visitor opens /join/{code}, creates their account
// (choosing their own password), then signs in and lands on the learner space.
test.describe("B-23 — auto-inscription par lien d'invitation", () => {
  test("admin crée l'invitation → un anonyme rejoint → l'apprenant voit son espace", async ({
    page,
    browser,
  }) => {
    test.setTimeout(120_000);

    // — admin: create an invitation from the « Invitations » section.
    await login(page, USERS.admin.email);
    await expect(page).toHaveURL(/\/admin$/);
    await page.getByTestId("admin-nav-invites").click();
    await expect(page.getByTestId("invite-create")).toBeVisible();
    await page.getByTestId("invite-create").click();

    const link = page.getByTestId("invite-link").first();
    await expect(link).toBeVisible();
    // The cell shows the full shareable URL; the raw code travels in data-code.
    const code = await link.getAttribute("data-code");
    expect(code).toBeTruthy();
    await expect(link).toContainText(`/join/${code}`);
    await expect(page.getByTestId("invite-status").first()).toHaveText("active");

    // — anonymous visitor: open the public landing and create the account.
    const anonCtx = await browser.newContext();
    const anon = await anonCtx.newPage();
    const email = `invite-${Date.now()}@e2e.test`;
    const password = "motdepasse-e2e!";
    await anon.goto(`/join/${code}`);
    await expect(anon.getByTestId("join-title")).toBeVisible();
    await expect(anon.getByTestId("join-cohort-name")).toBeVisible();
    await anon.getByTestId("join-name").fill("Eva Invitée");
    await anon.getByTestId("join-email").fill(email);
    await anon.getByTestId("join-password").fill(password);
    await anon.getByTestId("join-password2").fill(password);
    await anon.getByTestId("join-submit").click();

    // Success → /login with the « compte créé » notice.
    await expect(anon).toHaveURL(/\/login\?joined=1/);
    await expect(anon.getByTestId("join-success")).toBeVisible();

    // — the new learner signs in with their chosen password (no forced reset).
    await login(anon, email, password);
    await expect(anon).toHaveURL(/\/learner$/);
    await anonCtx.close();
  });

  test("un code invalide affiche un état d'erreur sans formulaire", async ({ browser }) => {
    const anonCtx = await browser.newContext();
    const anon = await anonCtx.newPage();
    await anon.goto("/join/code-inexistant-0000");
    await expect(anon.getByTestId("join-invalid")).toBeVisible();
    await expect(anon.getByTestId("join-submit")).toHaveCount(0);
    await anonCtx.close();
  });
});
