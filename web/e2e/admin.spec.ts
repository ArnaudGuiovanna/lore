import { test, expect } from "@playwright/test";
import { login, USERS } from "./helpers";

test.describe("Admin — identity / LLM matrix / outbox", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, USERS.admin.email);
    await expect(page).toHaveURL(/\/admin$/);
  });

  test("identity surface renders the invite form", async ({ page }) => {
    await page.getByRole("button", { name: /^identity$/i }).click();
    const invite = page.getByRole("form", { name: /invite a user/i });
    await expect(invite).toBeVisible();
    await expect(invite.getByLabel(/name/i)).toBeVisible();
    await expect(invite.getByLabel(/work email/i)).toBeVisible();
    await expect(invite.getByLabel(/role/i)).toBeVisible();
    await expect(invite.getByRole("button", { name: /invite user/i })).toBeVisible();
    // The membership table (live identity) is present.
    await expect(page.getByText(/roles are granted by membership/i)).toBeVisible();
  });

  test("LLM matrix renders with real configuration data", async ({ page }) => {
    await page.getByRole("button", { name: /llm matrix/i }).click();
    await expect(page.getByText(/which model speaks, and where/i)).toBeVisible();
    // Real matrix rows: at least the tenant scope tier is present in the table.
    const table = page.locator("table");
    await expect(table).toBeVisible();
    await expect(table.getByText("tenant", { exact: true }).first()).toBeVisible();
  });

  test("event outbox renders a real persisted trace", async ({ page }) => {
    await page.getByRole("button", { name: /event outbox/i }).click();
    await expect(page.getByText(/the change left a trace/i)).toBeVisible();
    // The seeded backend has emitted Syllabus events — assert a real one renders,
    // not the empty state.
    await expect(page.getByText(/Syllabus(Created|Bound)/).first()).toBeVisible();
  });
});
