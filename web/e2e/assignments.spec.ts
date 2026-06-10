import { test, expect } from "@playwright/test";
import { login, USERS } from "./helpers";

// B-26 — full evaluation loop: the trainer authors a bank question and a
// devoir, the learner hands in their work, the trainer grades it (note /100),
// and the learner sees their grade + feedback.
test.describe("B-26 — évaluations (banque, devoirs, correction)", () => {
  test("question + devoir + soumission + correction + note visible", async ({ browser }) => {
    test.setTimeout(150_000);
    const stamp = Date.now();
    const questionPrompt = `Question e2e ${stamp}`;
    const devoir = `Devoir e2e ${stamp}`;

    // — formateur : banque de questions + création du devoir.
    const trainerCtx = await browser.newContext();
    const trainer = await trainerCtx.newPage();
    await login(trainer, USERS.trainer.email);
    await expect(trainer).toHaveURL(/\/trainer$/);
    await trainer.goto("/trainer?section=evaluations");
    await expect(trainer.getByTestId("eval-tab-bank")).toBeVisible();

    // QCM with two choices, first one correct.
    await trainer.getByTestId("question-prompt").fill(questionPrompt);
    await trainer.getByTestId("question-choice-0").fill("Bonne réponse");
    await trainer.getByTestId("question-choice-1").fill("Mauvaise réponse");
    await trainer.getByTestId("question-correct-0").check();
    await trainer.getByTestId("question-create").click();
    await expect(trainer.getByText(questionPrompt)).toBeVisible();

    // Devoir for the console's cohort.
    await trainer.getByTestId("eval-tab-assignments").click();
    await trainer.getByTestId("assignment-title").fill(devoir);
    await trainer.getByTestId("assignment-desc").fill("Décrivez une transaction avec rollback.");
    await trainer.getByTestId("assignment-create").click();
    await expect(trainer.getByText(devoir)).toBeVisible();

    // — apprenant : soumission du rendu.
    const learnerCtx = await browser.newContext();
    const learner = await learnerCtx.newPage();
    await login(learner, USERS.learner.email);
    await expect(learner).toHaveURL(/\/learner$/);
    await learner.goto("/learner/assignments");
    await expect(learner.getByTestId("assignments-title")).toBeVisible();

    const card = learner.getByTestId("assignment-card").filter({ hasText: devoir });
    await expect(card).toBeVisible();
    await expect(card.getByTestId("assignment-status")).toHaveText("à rendre");
    await card.getByTestId("assignment-content").fill("Voici mon rendu e2e : BEGIN; …; ROLLBACK on error.");
    await card.getByTestId("assignment-submit").click();
    await expect(card.getByTestId("assignment-status")).toHaveText("rendu");

    // — formateur : file de correction, note 80/100 + feedback.
    await trainer.getByTestId("eval-tab-grading").click();
    await trainer.getByTestId("grading-assignment").selectOption({ label: devoir });
    const row = trainer.getByTestId("submission-row").first();
    await expect(row).toBeVisible();
    await expect(row.getByText(/voici mon rendu e2e/i)).toBeVisible();
    await row.getByTestId("grade-score").fill("80");
    await row.getByTestId("grade-feedback").fill("Bon travail.");
    await row.getByTestId("grade-submit").click();
    await expect(trainer.getByTestId("submission-score").first()).toHaveText("80/100");

    // — apprenant : la note et le feedback sont visibles.
    await learner.reload();
    const gradedCard = learner.getByTestId("assignment-card").filter({ hasText: devoir });
    await expect(gradedCard.getByTestId("assignment-status")).toHaveText("noté");
    await expect(gradedCard.getByTestId("assignment-grade")).toContainText("80/100");
    await expect(gradedCard.getByTestId("assignment-feedback")).toContainText("Bon travail.");

    await trainerCtx.close();
    await learnerCtx.close();
  });
});
