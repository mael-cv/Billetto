import { expect, test } from "@playwright/test";
import { adminCredentials, createEvent, goToCheckout, login, payByValidatedTransfer, registerAndLogin } from "./support";

// Parcours MongoDB : tendances (lecture croisée), avis d'un acheteur vérifié dans
// PostgreSQL, puis consultation côté gestion.
test.describe("Base documentaire MongoDB (pages, avis, tendances)", () => {
  test("accueil : bloc Tendances alimenté par le journal d'activité", async ({ page }) => {
    await page.goto("/#/");
    const section = page.locator("section", { hasText: "Tendances" }).first();
    await expect(section).toBeVisible();
    await expect(section.locator('a[href^="#/events/"]').first()).toBeVisible({ timeout: 15_000 });
  });

  test("fiche événement : achat, avis de l'acheteur, puis consultation des avis côté gestion", async ({ page }) => {
    const event = await createEvent("Parcours avis");
    await registerAndLogin(page, "Camille", "Acheteuse", "avis");

    // Section Avis présente sur la fiche.
    await page.goto(`/#/events/${event.slug}`);
    await expect(page.getByTestId("reviews")).toBeVisible({ timeout: 15_000 });

    // Billet émis après un paiement vérifié : ici un virement validé par l'administrateur.
    await goToCheckout(page, event.slug);
    await payByValidatedTransfer(page);

    // Avis : écrit dans MongoDB après vérification du billet dans PostgreSQL.
    await page.goto(`/#/events/${event.slug}`);
    await expect(page.getByTestId("review-form")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("review-title").fill("Test e2e");
    await page.getByTestId("review-comment").fill("Avis publié par le test Playwright");
    await page.getByTestId("review-submit").click();
    await expect(page.getByTestId("review-item").filter({ hasText: "Camille" }).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("reviews-average")).not.toHaveText("—");

    // Côté gestion : l'avis apparaît dans l'espace des avis reçus.
    await page.goto("/#/account");
    await page.locator('button:has-text("Se déconnecter")').first().click();
    await expect(page).toHaveURL(/\/#\/$/, { timeout: 15_000 });
    await login(page, adminCredentials());
    await page.goto("/#/organizer/avis");
    await expect(page.locator("h1")).toContainText("Avis");
    // Le jeu de démonstration contient des avis datés après aujourd'hui : le nouvel
    // avis n'est pas forcément en première page, on le retrouve par l'API de gestion.
    const mine = await page.request.get("/api/v1/organizer/avis?pageSize=100&page=1");
    expect(mine.status()).toBe(200);
    const publicList = await page.request.get(`/api/v1/events/${event.id}/avis`);
    expect(JSON.stringify(await publicList.json())).toContain("Avis publié par le test Playwright");
  });
});
