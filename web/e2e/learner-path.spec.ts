import { test, expect } from "@playwright/test";
import { login, USERS } from "./helpers";

// B-24/B-25 — minimal render smoke for the learner "Parcours" and "Agenda"
// surfaces. The seed ships no modules and no sessions, so the EMPTY states are
// the expected, valid renders; we only assert the stable page titles.
test.describe("Learner — parcours & agenda", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, USERS.learner.email);
    await expect(page).toHaveURL(/\/learner$/);
  });

  test("« Mon parcours » renders (empty state allowed)", async ({ page }) => {
    await page.goto("/learner/path");
    await expect(page.getByTestId("path-title")).toBeVisible();
  });

  test("« Agenda » renders (empty state allowed)", async ({ page }) => {
    await page.goto("/learner/agenda");
    await expect(page.getByTestId("agenda-title")).toBeVisible();
  });
});
