import { test, expect, type Browser, type Page } from "@playwright/test";
import { login, USERS } from "./helpers";

// Vague D — « Conformité OF » : profil légal + Qualiopi (B-08), documents
// contractuels (B-10), satisfaction & réclamations (B-11), RGPD/consentements
// (B-14/B-28) et financements + BPF (B-15). Workers=1 : les tests s'enchaînent
// dans l'ordre (l'apprenant voit ce que l'admin vient de créer).

const RUN = Date.now().toString(36);

async function loginAs(browser: Browser, who: "admin" | "learner"): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page, USERS[who].email);
  await expect(page).toHaveURL(new RegExp(`${USERS[who].home}$`));
  return page;
}

test.describe("Conformité OF — admin + apprenant", () => {
  test("a. le profil OF se sauvegarde et persiste au rechargement", async ({ page }) => {
    await login(page, USERS.admin.email);
    await expect(page).toHaveURL(/\/admin$/);
    await page.goto("/admin?section=conformite");
    await expect(page.getByTestId("of-profile-form")).toBeVisible();

    await page.getByTestId("of-profile-raison_sociale").fill(`Acme Learning SAS ${RUN}`);
    await page.getByTestId("of-profile-siret").fill("123 456 789 00012");
    await page.getByTestId("of-profile-nda").fill("11 75 12345 75");
    await page.getByTestId("of-profile-ville").fill("Paris");
    await page.getByTestId("of-profile-save").click();
    await expect(page.getByTestId("of-profile-saved")).toBeVisible();

    // Persistance : on recharge la page et on relit le backend.
    await page.reload();
    await expect(page.getByTestId("of-profile-raison_sociale")).toHaveValue(`Acme Learning SAS ${RUN}`);
    await expect(page.getByTestId("of-profile-siret")).toHaveValue("123 456 789 00012");
    await expect(page.getByTestId("of-profile-nda")).toHaveValue("11 75 12345 75");
  });

  test("b. une CONVENTION créée par l'admin est lisible par l'apprenant", async ({ page, browser }) => {
    const title = `Convention E2E ${RUN}`;

    await login(page, USERS.admin.email);
    await expect(page).toHaveURL(/\/admin$/);
    await page.goto("/admin?section=conformite");
    await page.getByTestId("conformite-tab-documents").click();
    await expect(page.getByTestId("doc-create-form")).toBeVisible();

    // Le gabarit CONVENTION est pré-rempli ; on personnalise le titre.
    await expect(page.getByTestId("doc-kind")).toHaveValue("CONVENTION");
    await page.getByTestId("doc-title").fill(title);
    await page.getByTestId("doc-create-submit").click();
    await expect(page.locator("tr", { hasText: title })).toBeVisible();

    // L'apprenant voit le document (portée tenant entier) et lit son contenu.
    const learner = await loginAs(browser, "learner");
    await learner.goto("/learner/documents");
    const card = learner.locator('[data-testid="learner-doc-card"]', { hasText: title });
    await expect(card).toBeVisible();
    await card.getByTestId("learner-doc-toggle").click();
    await expect(card.getByTestId("learner-doc-body")).toContainText("CONVENTION DE FORMATION");
    await learner.context().close();
  });

  test("c. enquête HOT : l'apprenant répond 5, l'admin lit la moyenne 5", async ({ page, browser }) => {
    const title = `Enquête à chaud E2E ${RUN}`;

    await login(page, USERS.admin.email);
    await expect(page).toHaveURL(/\/admin$/);
    await page.goto("/admin?section=conformite");
    await page.getByTestId("conformite-tab-satisfaction").click();
    await expect(page.getByTestId("survey-create-form")).toBeVisible();
    await page.getByTestId("survey-title").fill(title);
    // 1 question « échelle 1..5 » (le libellé par défaut convient).
    await page.getByTestId("survey-create-submit").click();
    await expect(page.locator("tr", { hasText: title })).toBeVisible();

    // L'apprenant répond 5 étoiles.
    const learner = await loginAs(browser, "learner");
    await learner.goto("/learner/surveys");
    const card = learner.locator('[data-testid="learner-survey-card"]', { hasText: title });
    await expect(card).toBeVisible();
    await card.getByTestId("survey-star-q1-5").click();
    await card.getByTestId("survey-submit").click();
    await expect(card.getByTestId("survey-answered")).toBeVisible();
    await learner.context().close();

    // L'admin voit la moyenne 5/5.
    await page.reload();
    await page.getByTestId("conformite-tab-satisfaction").click();
    await page.locator("tr", { hasText: title }).getByTestId("survey-results").click();
    await expect(page.getByTestId("survey-avg-q1")).toContainText("5");
    await expect(page.getByTestId("survey-avg-q1")).toContainText("moyenne");
  });

  test("d. CGU publiées : bannière de consentement, acceptation, registre", async ({ page, browser }) => {
    const marker = `CGU E2E ${RUN}`;

    await login(page, USERS.admin.email);
    await expect(page).toHaveURL(/\/admin$/);
    await page.goto("/admin?section=conformite");
    await page.getByTestId("conformite-tab-legal").click();
    await expect(page.getByTestId("legal-publish-form")).toBeVisible();
    await expect(page.getByTestId("legal-kind")).toHaveValue("CGU");
    await page
      .getByTestId("legal-body")
      .fill(`${marker}\n\nArticle 1 — Objet. Les présentes conditions régissent l'usage de la plateforme.`);
    await page.getByTestId("legal-publish-submit").click();
    await expect(page.getByTestId("legal-published")).toBeVisible();

    // L'apprenant voit la bannière (non bloquante), lit, accepte — elle disparaît.
    const learner = await loginAs(browser, "learner");
    await learner.goto("/learner/surveys"); // n'importe quelle page de l'espace apprenant
    const banner = learner.getByTestId("consent-banner");
    await expect(banner).toBeVisible();
    await banner.getByTestId("consent-read-CGU").click();
    await expect(banner).toContainText(marker);
    await banner.getByTestId("consent-accept-CGU").click();
    await expect(learner.getByTestId("consent-banner")).toHaveCount(0);
    await learner.context().close();

    // L'admin retrouve le consentement au registre (utilisateur, version, date).
    await page.reload();
    await page.getByTestId("conformite-tab-legal").click();
    await expect(
      page.locator("tr", { hasText: "Amara Okafor" }).filter({ hasText: "Conditions générales" }).first()
    ).toBeVisible();
  });

  test("e. dossier CPF 1 500 € + rapport BPF de l'année courante", async ({ page }) => {
    await login(page, USERS.admin.email);
    await expect(page).toHaveURL(/\/admin$/);
    await page.goto("/admin?section=conformite");
    await page.getByTestId("conformite-tab-financements").click();
    await expect(page.getByTestId("funding-create-form")).toBeVisible();

    // CPF est le financeur par défaut ; Amara est l'apprenante par défaut.
    await expect(page.getByTestId("funding-funder-type")).toHaveValue("CPF");
    await page.getByTestId("funding-reference").fill(`EDOF-${RUN}`);
    await page.getByTestId("funding-amount-input").fill("1500");
    await page.getByTestId("funding-create-submit").click();

    // 1500 € saisis → 150000 cents stockés → réaffichés "1 500,00 €".
    const row = page.locator("tr", { hasText: `EDOF-${RUN}` });
    await expect(row).toBeVisible();
    await expect(row.getByTestId("funding-amount")).toContainText(/1\s?500,00/);

    // Rapport BPF de l'année courante : une ligne CPF avec un produit en euros.
    // (Le backend agrège l'année entière — d'autres dossiers peuvent s'ajouter
    // d'un run à l'autre, on n'assert donc pas un total exact.)
    await expect(page.getByTestId("bpf-year")).toHaveValue(String(new Date().getFullYear()));
    await page.getByTestId("bpf-load").click();
    const report = page.getByTestId("bpf-report");
    await expect(report).toBeVisible();
    const cpfLine = report.locator("tr", { hasText: "CPF" }).first();
    await expect(cpfLine).toBeVisible();
    await expect(cpfLine).toContainText(/\d,00\s?€/); // produits CPF en euros (≥ ce dossier)
    await expect(report.getByText("stagiaires").first()).toBeVisible();
    await expect(report.getByText("heures formées")).toBeVisible();
  });
});
