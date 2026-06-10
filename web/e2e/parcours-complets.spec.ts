import { test, expect } from "@playwright/test";
import { login, USERS } from "./helpers";

// UX-03 — deux parcours bout en bout sur le backend seedé (workers=1, les
// étapes s'enchaînent dans l'ordre) :
//   (a) ADMIN : programme → cohorte → inscription de l'apprenant seed →
//       session planifiée → heures/progression dans la vue d'ensemble →
//       export Qualiopi téléchargé.
//   (b) APPRENANT : login → parcours → travailler une activité (start) →
//       Devoirs / Documents / Agenda accessibles depuis la nav.

const RUN = Date.now().toString(36);
const PROG = `Programme E2E ${RUN}`;
const COHORT = `Groupe E2E ${RUN}`;
const SESSION = `Session E2E ${RUN}`;

test.describe("UX-03 — parcours complets", () => {
  test("a. admin : programme → cohorte → inscription → session → overview → export Qualiopi", async ({ page }) => {
    test.setTimeout(150_000);
    await login(page, USERS.admin.email);
    await expect(page).toHaveURL(/\/admin$/);

    // 1) Créer le programme.
    await page.goto("/admin?section=structure");
    await page.locator("#prog-name").fill(PROG);
    await page.getByRole("button", { name: /créer le programme/i }).click();
    // router.refresh() repeuple le select « Dans le programme ».
    await expect(page.locator("#coh-prog option", { hasText: PROG })).toHaveCount(1);

    // 2) Créer la cohorte dans ce programme (dates pré-remplies à aujourd'hui).
    await page.locator("#coh-prog").selectOption({ label: PROG });
    await page.locator("#coh-name").fill(COHORT);
    await page.getByRole("button", { name: /créer le groupe/i }).click();
    await expect(page.locator("#enr-cohort option", { hasText: COHORT })).toHaveCount(1);

    // 3) Inscrire l'apprenant seed (Amara) dans la nouvelle cohorte.
    await page.locator("#enr-learner").selectOption({ label: "Amara Okafor" });
    await page.locator("#enr-cohort").selectOption({ label: COHORT });
    await page.getByRole("button", { name: /inscrire/i }).click();
    await expect(page.getByText(/inscrit\(e\)\./i)).toBeVisible();

    // 4) Planifier une session pour cette cohorte.
    await page.goto("/admin?section=sessions");
    const sessionForm = page.locator("form", { has: page.getByRole("button", { name: /planifier la session/i }) });
    await expect(sessionForm.locator("select option", { hasText: COHORT })).toHaveCount(1);
    await sessionForm.locator("select").first().selectOption({ label: COHORT });
    await sessionForm.getByLabel(/^titre$/).fill(SESSION);
    await sessionForm.getByLabel(/^date$/).fill(new Date().toISOString().slice(0, 10));
    await sessionForm.getByRole("button", { name: /planifier la session/i }).click();
    await expect(page.locator("tr", { hasText: SESSION })).toBeVisible();

    // 5) Vue d'ensemble : les heures de formation et la progression (CSV) sont lisibles.
    await page.goto("/admin");
    await expect(page.getByText("Heures de formation")).toBeVisible();
    await expect(page.getByText("Maîtrise moy. du groupe")).toBeVisible();
    await expect(page.getByText(/temps de formation par apprenant \(CSV\)/i)).toBeVisible();
    await expect(page.getByText(/progression & complétion par apprenant \(CSV\)/i)).toBeVisible();

    // 6) Export Qualiopi de la nouvelle cohorte (téléchargement JSON).
    await page.goto("/admin?section=conformite");
    await expect(page.getByTestId("qualiopi-cohort")).toBeVisible();
    await page.getByTestId("qualiopi-cohort").selectOption({ label: COHORT });
    const downloadPromise = page.waitForEvent("download");
    await page.getByTestId("qualiopi-download").click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain("qualiopi-");
  });

  test("b. apprenant : parcours → activité (start) → Devoirs / Documents / Agenda", async ({ page }) => {
    test.setTimeout(150_000);
    await login(page, USERS.learner.email);
    await expect(page).toHaveURL(/\/learner$/);
    await expect(page.getByTestId("now-intent-line")).toBeVisible();

    // 1) Consulter le parcours (B-24) — l'état vide est un rendu valide du seed.
    await page.goto("/learner/path");
    await expect(page.getByTestId("path-title")).toBeVisible();

    // 2) Travailler une activité : « Commencer » interroge le vrai runtime
    // (POST /activities/next puis /start) et ouvre la lecture.
    await page.goto("/learner");
    await page.getByRole("button", { name: /commencer/i }).click();
    await expect(page.getByRole("button", { name: /j'ai terminé/i })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/justification du runtime/i)).toBeVisible();

    // 3) Devoirs, Documents et Agenda restent accessibles depuis la nav.
    await page.getByTestId("learner-nav-assignments").click();
    await expect(page.getByTestId("assignments-title")).toBeVisible();
    await page.getByTestId("learner-nav-documents").click();
    await expect(page.getByTestId("learner-docs-title")).toBeVisible();
    await page.getByRole("link", { name: "Agenda" }).click();
    await expect(page.getByTestId("agenda-title")).toBeVisible();
  });
});
