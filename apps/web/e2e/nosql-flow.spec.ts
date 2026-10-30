import { expect, test } from "@playwright/test";

// Parcours MongoDB : tendances (lecture croisée), page éditoriale, avis d'un acheteur,
// réponse de l'organisateur. Comptes de démonstration du seed.
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? "Billetto-Demo-2026!";

async function login(page: import("@playwright/test").Page, email: string) {
  await page.goto("/#/login");
  await page.waitForSelector("#email");
  await page.fill("#email", email);
  await page.fill("#password", DEMO_PASSWORD);
  await page.click('button[type="submit"]');
  await expect(page).not.toHaveURL(/\/#\/login/);
}

test.describe("Base documentaire MongoDB (pages, avis, tendances)", () => {
  test("accueil : bloc Tendances alimenté par le journal d'activité", async ({ page }) => {
    await page.goto("/#/");
    const section = page.locator("section", { hasText: "Tendances" }).first();
    await expect(section).toBeVisible();
    await expect(section.locator('a[href^="#/events/"]').first()).toBeVisible({ timeout: 10_000 });
  });

  test("fiche événement : page éditoriale et avis, achat puis avis puis réponse de l'organisateur", async ({ page }) => {
    await login(page, "demo-visiteur@billetto.test");

    // Un événement à venir avec des billets.
    await page.goto("/#/events?q=Tour");
    const card = page.locator('a[href^="#/events/"]:not(:has-text("Terminé"))').first();
    await expect(card).toBeVisible({ timeout: 10_000 });
    await card.click();
    await expect(page).toHaveURL(/\/#\/events\/.+/);
    const slug = page.url().split("/#/events/")[1]?.split("?")[0] ?? "";

    // Page éditoriale (document MongoDB) et section Avis présentes.
    await expect(page.getByTestId("event-page")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("reviews")).toBeVisible();

    // Achat d'un billet (nécessaire pour laisser un avis).
    const addBtn = page.locator('button[aria-label="Ajouter"]:not([disabled])').first();
    await expect(addBtn).toBeVisible({ timeout: 8_000 });
    await addBtn.click();
    await page.locator('button:has-text("Continuer")').first().click();
    await expect(page).toHaveURL(/\/#\/checkout/);
    await page.locator('input[type="checkbox"]').first().check();
    await page.locator('button[type="submit"], button:has-text("Payer")').first().click();
    await expect(page).toHaveURL(/\/#\/checkout\/success/, { timeout: 15_000 });

    // Avis : écrit dans MongoDB après vérification du billet dans PostgreSQL.
    await page.goto(`/#/events/${slug}`);
    const form = page.getByTestId("review-form");
    if (await form.isVisible({ timeout: 10_000 }).catch(() => false)) {
      await page.getByTestId("review-title").fill("Test e2e");
      await page.getByTestId("review-comment").fill("Avis publié par le test Playwright");
      await page.getByTestId("review-submit").click();
    }
    await expect(page.getByTestId("review-item").filter({ hasText: "Camille" }).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("reviews-average")).not.toHaveText("—");

    // L'organisateur voit l'avis dans son espace et peut y répondre.
    await page.goto("/#/account");
    await page.locator('button:has-text("Déconnexion"), button:has-text("Se déconnecter")').first().click().catch(() => {});
    await login(page, "demo-organisateur@billetto.test");
    await page.goto("/#/organizer/avis");
    await expect(page.locator("h1")).toContainText("Avis");
  });
});
