import { expect, test } from "@playwright/test";

test.describe("Sécurité & Gestion des erreurs", () => {
  test("mauvais identifiants de connexion affiche une erreur explicite", async ({ page }) => {
    await page.goto("/#/login");
    await page.waitForSelector("#email");
    await page.fill("#email", "inconnu@billetto.test");
    await page.fill("#password", "MauvaisMotDePasse123!");
    await page.click('button[type="submit"]');

    // Message d'erreur
    const alert = page.locator('[role="alert"], div.text-destructive, div:has-text("Identifiants incorrects")').first();
    await expect(alert).toBeVisible({ timeout: 8_000 });
  });

  test("accès direct à une page protégée sans session affiche un écran de connexion requise", async ({ page }) => {
    await page.goto("/#/tickets");
    // L'écran RequireAuth affiche "Connexion requise"
    await expect(page.locator("h1")).toContainText("Connexion requise", { timeout: 8_000 });
    await expect(page.locator('button:has-text("Se connecter")')).toBeVisible();
  });

  test("accès à /admin par un compte visiteur affiche un écran 403 Accès réservé", async ({ page }) => {
    // 1. Inscription visiteur
    const email = `visiteur-403-${Date.now()}@test.billetto.local`;
    await page.goto("/#/register");
    await page.waitForSelector("#prenom");
    await page.fill("#prenom", "Bob");
    await page.fill("#nom", "Martin");
    await page.fill("#email", email);
    await page.fill("#password", "Password12345!");
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/#\/(tickets|$)/);

    // 2. Tentative d'accès à la page d'administration
    await page.goto("/#/admin");
    await expect(page.locator("h1")).toContainText("Accès réservé", { timeout: 8_000 });
    await expect(page.locator("text=403")).toBeVisible();
  });
});
