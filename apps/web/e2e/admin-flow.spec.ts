import { expect, test } from "@playwright/test";
import { adminCredentials, login } from "./support";

test.describe("Parcours Administrateur", () => {
  test("connexion admin, consultation plateforme, gestion utilisateurs et audit des tarifs", async ({ page }) => {
    // 1. Connexion de l'administrateur créé par l'assistant de premier démarrage
    await login(page, adminCredentials());
    await expect(page).toHaveURL(/\/#\/admin/, { timeout: 15_000 });

    // 2. Page administration
    await expect(page.locator("h1")).toContainText("Administration");
    await expect(page.locator("text=Utilisateurs").first()).toBeVisible();
    await expect(page.locator("text=Événements").first()).toBeVisible();

    // 3. Table des utilisateurs
    await expect(page.locator("table").first()).toBeVisible({ timeout: 15_000 });

    // 4. Audit des tarifs (journal_tarifs issu du trigger PostgreSQL)
    const auditTab = page.locator('button:has-text("Audit des tarifs")');
    await expect(auditTab).toBeVisible();
    await auditTab.click();
    const auditContent = page
      .locator("text=Modification de tarif")
      .or(page.locator("text=Suppression de tarif"))
      .or(page.locator("text=Journal vide"))
      .or(page.locator("text=trigger d'audit"));
    await expect(auditContent.first()).toBeVisible({ timeout: 15_000 });
  });
});
