import { test, expect } from "@playwright/test";
import { login, USERS } from "./helpers";

test.describe("Admin — identity / LLM matrix / outbox", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, USERS.admin.email);
    await expect(page).toHaveURL(/\/admin$/);
  });

  test("identity surface renders the invite form", async ({ page }) => {
    // Nav buttons are addressed by stable test ids (labels are now French).
    await page.getByTestId("admin-nav-identity").click();
    // FR form "Inviter un utilisateur" with labels Nom / E-mail professionnel / Rôle.
    const invite = page.getByRole("form", { name: /inviter un utilisateur/i });
    await expect(invite).toBeVisible();
    await expect(invite.getByLabel(/^nom$/i)).toBeVisible();
    await expect(invite.getByLabel(/e-mail professionnel/i)).toBeVisible();
    await expect(invite.getByLabel(/rôle/i)).toBeVisible();
    await expect(invite.getByRole("button", { name: /inviter l'utilisateur/i })).toBeVisible();
    // The membership table (live identity) is present — FR heading.
    await expect(page.getByText(/les rôles sont accordés par l'appartenance/i)).toBeVisible();
  });

  test("LLM matrix renders with real configuration data", async ({ page }) => {
    await page.getByTestId("admin-nav-llm").click();
    // FR: "Quel modèle parle, et où".
    await expect(page.getByText(/quel modèle parle, et où/i)).toBeVisible();
    // Real matrix rows: the tenant scope tier id ("tenant") is unchanged data.
    const table = page.locator("table");
    await expect(table).toBeVisible();
    await expect(table.getByText("tenant", { exact: true }).first()).toBeVisible();
  });

  test("event outbox renders a real persisted trace", async ({ page }) => {
    await page.getByTestId("admin-nav-outbox").click();
    // FR: "Le changement a laissé une trace".
    await expect(page.getByText(/le changement a laissé une trace/i)).toBeVisible();
    // The seeded backend has emitted Syllabus events — assert a real one renders,
    // not the empty state. Event type ids stay in the backend's language.
    await expect(page.getByText(/Syllabus(Created|Bound)/).first()).toBeVisible();
  });
});
