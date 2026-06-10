import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { login, USERS } from "./helpers";

// B-19 — RGAA/axe : balayage automatique wcag2a + wcag2aa des surfaces clés de
// chaque rôle. Politique : 0 violation `critical` (échec du test) ; les
// violations `serious` sont LOGGÉES en console sans faire échouer la suite —
// elles sont reprises dans le bilan de fin de vague.

async function expectNoCritical(page: Page, name: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const critical = results.violations.filter((v) => v.impact === "critical");
  const serious = results.violations.filter((v) => v.impact === "serious");
  for (const v of serious) {
    // Loggées, jamais bloquantes : matière du bilan d'accessibilité.
    console.log(
      `[a11y][serious] ${name} — ${v.id} (${v.nodes.length} nœud(s)) : ${v.help} → ${v.nodes
        .slice(0, 3)
        .map((n) => n.target.join(" "))
        .join(" | ")}`
    );
  }
  expect(
    critical.map(
      (v) => `${v.id} : ${v.help} → ${v.nodes.slice(0, 5).map((n) => n.target.join(" ")).join(" | ")}`
    ),
    `violations critical sur ${name}`
  ).toEqual([]);
}

test.describe("B-19 — accessibilité (axe, wcag2a/wcag2aa)", () => {
  test("console admin : 0 violation critical", async ({ page }) => {
    test.setTimeout(120_000);
    await login(page, USERS.admin.email);
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByTestId("control-plane-kicker")).toBeVisible();
    await expectNoCritical(page, "/admin (vue d'ensemble)");

    await page.goto("/admin?section=identity");
    await expect(page.getByRole("form", { name: /inviter un utilisateur/i })).toBeVisible();
    await expectNoCritical(page, "/admin?section=identity");

    await page.goto("/admin?section=conformite");
    await expect(page.getByTestId("of-profile-form")).toBeVisible();
    await expectNoCritical(page, "/admin?section=conformite");
  });

  test("console formateur : 0 violation critical", async ({ page }) => {
    test.setTimeout(120_000);
    await login(page, USERS.trainer.email);
    await expect(page).toHaveURL(/\/trainer$/);
    await expect(page.getByText(/console formateur/i).first()).toBeVisible();
    await expectNoCritical(page, "/trainer (concevoir)");

    await page.goto("/trainer?section=evaluations");
    await expect(page.getByTestId("eval-tab-bank")).toBeVisible();
    await expectNoCritical(page, "/trainer?section=evaluations");

    await page.goto("/trainer?section=curation");
    await expect(page.getByTestId("curation-tab-PENDING_REVIEW")).toBeVisible();
    await expectNoCritical(page, "/trainer?section=curation");
  });

  test("espace apprenant : 0 violation critical", async ({ page }) => {
    test.setTimeout(120_000);
    await login(page, USERS.learner.email);
    await expect(page).toHaveURL(/\/learner$/);
    await expect(page.getByTestId("learner-banner")).toBeVisible();
    await expectNoCritical(page, "/learner (accueil)");

    await page.goto("/learner/path");
    await expect(page.getByTestId("path-title")).toBeVisible();
    await expectNoCritical(page, "/learner/path");
  });
});
