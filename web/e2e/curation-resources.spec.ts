import { test, expect, type Browser, type Page } from "@playwright/test";
import { login, USERS } from "./helpers";

// Dernière vague — B-16 (curation), B-17 (ressources), B-18 (annonces).
// Workers=1 : l'apprenant lit ce que le formateur vient de publier.

const RUN = Date.now().toString(36);

async function loginAs(browser: Browser, who: "trainer" | "learner"): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page, USERS[who].email);
  await expect(page).toHaveURL(new RegExp(`${USERS[who].home}$`));
  return page;
}

test.describe("B-16/B-17/B-18 — curation, ressources, annonces", () => {
  test("a. curation : la file répond (0 contenu toléré en mode instruction_only)", async ({ page }) => {
    // Le seed tourne en instruction_only : le tuteur peut n'avoir généré aucun
    // contenu LLM à relire. Le flux API doit répondre 200 dans tous les cas ;
    // si la file est vide, l'état vide est LE rendu attendu — le verdict
    // Approuver/Rejeter n'est exercé que lorsqu'un contenu existe (skip
    // conditionnel documenté ci-dessous).
    await login(page, USERS.trainer.email);
    await expect(page).toHaveURL(/\/trainer$/);

    // Flux API : la lecture de la file répond 200 avec un tableau (même vide).
    const apiRes = await page.request.get("/api/trainer/content-review?status=PENDING_REVIEW");
    expect(apiRes.status()).toBe(200);
    const pendingList = (await apiRes.json()) as unknown[];
    expect(Array.isArray(pendingList)).toBe(true);

    await page.goto("/trainer?section=curation");
    await expect(page.getByTestId("curation-tab-PENDING_REVIEW")).toBeVisible();

    if (pendingList.length === 0) {
      // File vide (seed instruction_only) : l'UI montre l'état vide, honnête.
      await expect(page.getByTestId("curation-empty")).toBeVisible();
      test.info().annotations.push({
        type: "note",
        description:
          "file de curation vide (seed instruction_only) — verdict APPROVED/REJECTED non exercé sur ce run",
      });
      return;
    }

    // Un contenu attend un verdict : on approuve le premier — il quitte la file.
    const before = await page.getByTestId("curation-card").count();
    expect(before).toBeGreaterThan(0);
    await page.getByTestId("curation-approve").first().click();
    await expect(page.getByTestId("curation-card")).toHaveCount(before - 1);
  });

  test("b. ressources : fichier partagé par le formateur, téléchargé par l'apprenant", async ({ page, browser }) => {
    const title = `Aide-mémoire E2E ${RUN}`;
    const body = `contenu de la ressource e2e ${RUN}`;

    // — formateur : upload d'un fichier visible de tout l'organisme.
    await login(page, USERS.trainer.email);
    await expect(page).toHaveURL(/\/trainer$/);
    await page.goto("/trainer?section=resources");
    await expect(page.getByTestId("resource-create")).toBeVisible();
    await page.getByTestId("resource-title").fill(title);
    await page.getByTestId("resource-file").setInputFiles({
      name: "aide-memoire.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(body, "utf-8"),
    });
    await page.getByTestId("resource-create").click();
    await expect(page.getByTestId("resource-title-cell").filter({ hasText: title })).toBeVisible();

    // — apprenant : la ressource est dans son périmètre, le proxy streame les octets.
    const learner = await loginAs(browser, "learner");
    await learner.goto("/learner/resources");
    const card = learner.locator('[data-testid="learner-resource-card"]', { hasText: title });
    await expect(card).toBeVisible();
    await expect(card.getByText(/text\/plain/)).toBeVisible();
    const href = await card.getByTestId("learner-resource-download").getAttribute("href");
    expect(href).toBeTruthy();
    const dl = await learner.request.get(href as string);
    expect(dl.status()).toBe(200);
    expect(await dl.text()).toBe(body);
    await learner.context().close();
  });

  test("c. annonces : publiée par le formateur, en tête de l'accueil apprenant", async ({ page, browser }) => {
    const title = `Annonce E2E ${RUN}`;

    // — formateur : annonce tenant-wide (destinataires = tout l'organisme).
    await login(page, USERS.trainer.email);
    await expect(page).toHaveURL(/\/trainer$/);
    await page.goto("/trainer?section=announcements");
    await expect(page.getByTestId("announcement-publish")).toBeVisible();
    await page.getByTestId("announcement-title").fill(title);
    await page.getByTestId("announcement-body").fill(`Rendez-vous jeudi — run ${RUN}.`);
    await page.getByTestId("announcement-publish").click();
    await expect(
      page.locator('[data-testid="announcement-card"]', { hasText: title })
    ).toBeVisible();

    // — apprenant : les 3 plus récentes s'affichent en tête de l'accueil.
    const learner = await loginAs(browser, "learner");
    await learner.goto("/learner");
    const strip = learner.getByTestId("learner-announcements");
    await expect(strip).toBeVisible();
    await expect(strip.locator('[data-testid="learner-announcement"]', { hasText: title })).toBeVisible();
    await learner.context().close();

    // — nettoyage : on archive l'annonce pour garder l'accueil stable d'un run à l'autre.
    const cardRow = page.locator('[data-testid="announcement-card"]', { hasText: title });
    await cardRow.getByTestId("announcement-archive").click();
    await expect(cardRow).toHaveCount(0);
  });

  test("d. positionnement (B-13) : la vue répond — l'évidence arrive avec la 1re évaluation corrigée", async ({ page }) => {
    await login(page, USERS.trainer.email);
    await expect(page).toHaveURL(/\/trainer$/);
    await page.goto("/trainer?section=evaluations");
    await page.getByTestId("eval-tab-positioning").click();
    await expect(page.getByTestId("positioning-learner")).toBeVisible();
    // Le seed ne contient pas forcément d'évaluation corrigée : le tableau (avec
    // lignes date/concept/score) OU l'état vide honnête sont des rendus valides.
    await expect(
      page
        .getByTestId("positioning-score")
        .first()
        .or(page.getByText(/aucune évaluation corrigée pour cet apprenant/i))
    ).toBeVisible();
    // Le flux API répond 200 avec un tableau (même vide) pour l'apprenant choisi.
    const learnerId = await page.getByTestId("positioning-learner").inputValue();
    const apiRes = await page.request.get(
      `/api/trainer/positioning?learnerId=${encodeURIComponent(learnerId)}`
    );
    expect(apiRes.status()).toBe(200);
    expect(Array.isArray(await apiRes.json())).toBe(true);
  });
});
