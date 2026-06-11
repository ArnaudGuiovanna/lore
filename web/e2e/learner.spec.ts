import { test, expect } from "@playwright/test";
import { login, USERS } from "./helpers";

function plannedActivityResponse(generated: { provider: string; model: string; content: string }) {
  return {
    decision_id: "decision-e2e",
    activity: {
      tenant_id: "tenant-e2e",
      id: "activity-e2e",
      learner_id: "learner-e2e",
      domain_id: "domain-e2e",
      concept_id: "concept-e2e",
      activity_type: "GUIDED_PRACTICE",
      difficulty_target: 0.62,
      status: "PLANNED",
      instruction_id: "instruction-e2e",
      audit_rationale: "e2e planned by runtime",
      created_at: "2026-06-07T00:00:00Z",
    },
    tutor_instruction: {
      id: "instruction-e2e",
      tenant_id: "tenant-e2e",
      learner_id: "learner-e2e",
      domain_id: "domain-e2e",
      concept_id: "concept-e2e",
      activity_id: "activity-e2e",
      activity_type: "GUIDED_PRACTICE",
      difficulty_target: 0.62,
      constraints: [],
      allowed_variants: [],
      context: {},
      created_at: "2026-06-07T00:00:00Z",
    },
    generated_content: {
      tenant_id: "tenant-e2e",
      id: "content-e2e",
      instruction_id: "instruction-e2e",
      provider: generated.provider,
      model: generated.model,
      content: generated.content,
      created_at: "2026-06-07T00:00:00Z",
    },
  };
}

test.describe("Learner loop — runtime intent + provenance", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, USERS.learner.email);
    await expect(page).toHaveURL(/\/learner$/);
  });

  test("the Now surface shows the runtime-decided intent", async ({ page }) => {
    // The runtime's decision is ONE human sentence (INVITE shell), marked with
    // the runtime provenance mark — never narrated. Asserted via a stable test id.
    await expect(page.getByTestId("now-intent")).toBeVisible();
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

  test("the Now workbench renders generated LLM content when returned by the API", async ({ page }) => {
    await page.route("**/api/activities/next", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          plannedActivityResponse({
            provider: "openai",
            model: "gpt-test",
            content: "Contenu généré E2E pour l'apprenant.",
          })
        ),
      });
    });

    await page.getByRole("button", { name: /commencer/i }).click();

    await expect(page.getByText(/généré par le LLM/i)).toBeVisible();
    await expect(page.getByText(/openai\/gpt-test/i)).toBeVisible();
    await expect(page.getByText(/Contenu généré E2E/i)).toBeVisible();
    await expect(page.getByText(/fallback local/i)).toHaveCount(0);
  });

  test("the Now workbench keeps instruction-only generated content isolated", async ({ page }) => {
    await page.route("**/api/activities/next", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          plannedActivityResponse({
            provider: "instruction_only",
            model: "runtime",
            content: "Instruction-only persisté E2E.",
          })
        ),
      });
    });

    await page.getByRole("button", { name: /commencer/i }).click();

    // Exact match: the sidebar also says "tuteur en instruction seule".
    await expect(page.getByText("instruction seule", { exact: true })).toBeVisible();
    await expect(page.getByText(/instruction_only\/runtime/i)).toBeVisible();
    await expect(page.getByText(/contenu persisté/i)).toBeVisible();
    await expect(page.getByText(/Instruction-only persisté E2E/i)).toBeVisible();
    await expect(page.getByText(/fallback local/i)).toHaveCount(0);
  });
});
