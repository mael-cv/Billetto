import { expect, test } from "@playwright/test";
import { adminCredentials, paceAuth, randomPassword, registerAndLogin, uniqueEmail } from "./support";

test.describe("Sécurité & Gestion des erreurs", () => {
  test("mauvais identifiants de connexion affiche une erreur explicite", async ({ page }) => {
    await page.goto("/#/login");
    await page.waitForSelector("#email");
    await page.fill("#email", uniqueEmail("inconnu"));
    await page.fill("#password", randomPassword());
    await paceAuth();
    await page.click('button[type="submit"]');
    await expect(page.locator('[role="alert"]').first()).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/\/#\/login/);
  });

  test("accès direct à une page protégée sans session affiche un écran de connexion requise", async ({ page }) => {
    await page.goto("/#/tickets");
    await expect(page.locator("h1")).toContainText("Connexion requise", { timeout: 15_000 });
    await expect(page.locator('button:has-text("Se connecter")')).toBeVisible();
  });

  test("accès à /admin par un compte visiteur affiche un écran 403 Accès réservé", async ({ page }) => {
    await registerAndLogin(page, "Bob", "Martin", "visiteur-403");
    await page.goto("/#/admin");
    await expect(page.locator("h1")).toContainText("Accès réservé", { timeout: 15_000 });
    await expect(page.locator("text=403")).toBeVisible();
  });

  test("inscription : même parcours que l'adresse soit libre ou déjà utilisée, sans session ouverte", async ({ page }) => {
    for (const email of [uniqueEmail("libre"), adminCredentials().email]) {
      await page.goto("/#/register");
      await page.waitForSelector("#prenom");
      await page.fill("#prenom", "Eve");
      await page.fill("#nom", "Curieuse");
      await page.fill("#email", email);
      await page.fill("#password", randomPassword());
      await paceAuth();
      await page.click('button[type="submit"]');
      // Dans les deux cas : retour à la connexion, aucun message « compte existant ».
      await expect(page).toHaveURL(/\/#\/login/, { timeout: 15_000 });
      await expect(page.locator("text=existe déjà")).toHaveCount(0);
    }
    await page.goto("/#/tickets");
    await expect(page.locator("h1")).toContainText("Connexion requise", { timeout: 15_000 });
  });
});
