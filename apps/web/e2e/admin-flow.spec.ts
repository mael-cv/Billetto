import { expect, test } from "@playwright/test";

test.describe("Parcours Administrateur", () => {
  test("connexion admin, consultation plateforme, gestion utilisateurs et audit des tarifs", async ({ page }) => {
    // 1. Connexion admin
    await page.goto("/#/login");
    await page.waitForSelector("#email");
    await page.fill("#email", "demo-admin@billetto.test");
    await page.fill("#password", "Billetto-Demo-2026!");
    await page.click('button[type="submit"]');

    // Redirection automatique vers /admin
    await expect(page).toHaveURL(/\/#\/admin/, { timeout: 10_000 });

    // 2. Page administration
    await expect(page.locator("h1")).toContainText("Administration");

    // Vérification des statistiques globales
    await expect(page.locator("text=Utilisateurs").first()).toBeVisible();
    await expect(page.locator("text=Événements").first()).toBeVisible();

    // 3. Consultation de la table des utilisateurs
    const usersTable = page.locator("table").first();
    await expect(usersTable).toBeVisible({ timeout: 10_000 });

    // 4. Consultation de l'audit des tarifs (journal_tarifs issu du trigger PostgreSQL)
    const auditTab = page.locator('button:has-text("Audit des tarifs")');
    await expect(auditTab).toBeVisible();
    await auditTab.click();

    // La section audit s'affiche (soit la liste des modifications, soit l'état journal vide)
    const auditContent = page.locator("text=Modification de tarif")
      .or(page.locator("text=Suppression de tarif"))
      .or(page.locator("text=Journal vide"))
      .or(page.locator("text=trigger d'audit"));
    await expect(auditContent.first()).toBeVisible({ timeout: 10_000 });
  });
});
