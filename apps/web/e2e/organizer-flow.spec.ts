import { expect, test } from "@playwright/test";

test.describe("Parcours Organisateur", () => {
  test("connexion organisateur, consultation tableau de bord (RLS) et gestion des événements", async ({ page }) => {
    // 1. Connexion
    await page.goto("/#/login");
    await page.waitForSelector("#email");
    await page.fill("#email", "demo-organisateur@billetto.test");
    await page.fill("#password", "Billetto-Demo-2026!");
    await page.click('button[type="submit"]');

    // Redirection automatique vers /organizer
    await expect(page).toHaveURL(/\/#\/organizer/, { timeout: 10_000 });

    // 2. Tableau de bord organisateur
    await expect(page.locator("h1")).toContainText("Tableau de bord");
    // Vérification de la présence des cartes de statistiques
    const statsContainer = page.locator('[data-testid="stats"]');
    await expect(statsContainer).toBeVisible({ timeout: 10_000 });
    await expect(statsContainer).toContainText("Chiffre d'affaires");
    await expect(statsContainer).toContainText("Billets vendus");

    // 3. Mes événements
    await page.goto("/#/organizer/events");
    await expect(page.locator("h1")).toContainText("Mes événements");

    // La table des événements de l'organisateur est chargée
    const eventsTable = page.locator('[data-testid="organizer-events"], table');
    await expect(eventsTable).toBeVisible({ timeout: 10_000 });

    // 4. Action de publication / dépublication
    const toggleBtn = page.locator('button:has-text("Publier"), button:has-text("Dépublier")').first();
    if (await toggleBtn.isVisible()) {
      const initialText = (await toggleBtn.textContent())?.trim();
      await toggleBtn.click();
      // Un toast ou un changement d'état s'affiche
      await expect(page.locator('[role="status"], [data-testid="toast"]').first()).toBeVisible({ timeout: 5_000 });
    }
  });
});
