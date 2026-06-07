import { test, expect } from "@playwright/test";
import { login, USERS } from "./helpers";

test.describe("Learner loop — runtime intent + provenance", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, USERS.learner.email);
    await expect(page).toHaveURL(/\/learner$/);
  });

  test("the Now surface shows the runtime-decided intent", async ({ page }) => {
    // The runtime owns progression; the intent card states that plainly.
    await expect(page.getByText(/the runtime plans this step/i)).toBeVisible();
    // The begin affordance into the loop is present.
    await expect(page.getByRole("button", { name: /begin/i })).toBeVisible();
  });

  test('"why this path?" provenance is present and links to the lineage', async ({ page }) => {
    const why = page.getByRole("link", { name: /why this path/i });
    await expect(why).toBeVisible();
    await expect(page.getByText(/from your cohort.s syllabus/i)).toBeVisible();

    await why.click();
    await expect(page).toHaveURL(/\/learner\/provenance$/);
    await expect(page.getByText(/where your parcours comes from/i)).toBeVisible();
  });
});
