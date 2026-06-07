import { test, expect } from "@playwright/test";
import { login, USERS } from "./helpers";

test.describe("Learner loop — runtime intent + provenance", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, USERS.learner.email);
    await expect(page).toHaveURL(/\/learner$/);
  });

  test("the Now surface shows the runtime-decided intent", async ({ page }) => {
    // The runtime owns progression; the intent line states that plainly (FR:
    // "le runtime planifie cette étape"). Asserted via a stable test id.
    await expect(page.getByTestId("now-intent-line")).toBeVisible();
    await expect(page.getByTestId("now-intent-line")).toContainText(/le runtime planifie cette étape/i);
    // The begin affordance into the loop is present (FR: "Commencer").
    await expect(page.getByRole("button", { name: /commencer/i })).toBeVisible();
  });

  test('"why this path?" provenance is present and links to the lineage', async ({ page }) => {
    // FR: "pourquoi ce parcours ?" link + "issu du syllabus de votre groupe" line.
    const why = page.getByTestId("why-this-path");
    await expect(why).toBeVisible();
    await expect(why).toContainText(/pourquoi ce parcours/i);
    await expect(page.getByTestId("now-syllabus-line")).toBeVisible();

    await why.click();
    await expect(page).toHaveURL(/\/learner\/provenance$/);
    // FR: "D'où vient votre parcours."
    await expect(page.getByTestId("provenance-title")).toBeVisible();
  });
});
