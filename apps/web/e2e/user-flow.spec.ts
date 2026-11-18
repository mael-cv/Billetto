import { expect, test } from "@playwright/test";
import { createEvent, goToCheckout, payByValidatedTransfer, registerAndLogin } from "./support";

test.describe("Parcours Utilisateur (visiteur -> inscription -> achat -> billet -> remboursement)", () => {
  test("inscription, découverte, réservation, virement validé, billet et remboursement", async ({ page }) => {
    const event = await createEvent("Parcours utilisateur");

    // 1. Inscription : aucune session ouverte, connexion explicite ensuite.
    await registerAndLogin(page, "Alice", "Dupont");
    await expect(page).toHaveURL(/\/#\/(tickets|$)/);

    // 2. Catalogue
    await page.goto("/#/events");
    await expect(page.locator("h1")).toContainText("Découvrir");

    // 3. Fiche de l'événement, sélection d'un billet, page de paiement
    await goToCheckout(page, event.slug);
    await expect(page.locator("h1")).toContainText("Paiement");

    // 4. Aucun billet tant que le paiement n'est pas confirmé côté serveur.
    await payByValidatedTransfer(page);

    // 5. Mes billets : le billet apparaît une fois le virement validé.
    await page.goto("/#/tickets");
    await page.reload(); // la liste est mise en cache 30 s côté navigateur
    await expect(page.locator("h1")).toContainText("Mes billets");
    await expect(page.locator("text=Valide").first()).toBeVisible({ timeout: 15_000 });

    // 6. Remboursement de la commande
    const refundBtn = page.locator('button:has-text("Rembourser")').first();
    await expect(refundBtn).toBeVisible({ timeout: 10_000 });
    await refundBtn.click();
    await expect(page.locator("text=Remboursé").first()).toBeVisible({ timeout: 10_000 });
  });

  test("paiement par carte : la réservation ne devient jamais une commande sans confirmation du prestataire", async ({ page }) => {
    const event = await createEvent("Parcours carte");
    await registerAndLogin(page, "Chloé", "Martin", "carte");
    await goToCheckout(page, event.slug);

    // La page de paiement du prestataire n'est pas suivie : on vérifie seulement que
    // le front n'obtient aucune commande en retour de l'ouverture du paiement.
    let checkoutBody: unknown = null;
    await page.route("**/api/v1/orders/holds/*/checkout", async (route) => {
      const response = await route.fetch();
      checkoutBody = await response.json().catch(() => null);
      // Réponse neutralisée : pas de redirection hors du site pendant le test.
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "TEST", message: "Paiement non suivi pendant le test" }),
      });
    });
    await page.locator("#cgv").check();
    await page.locator('button[type="submit"]').filter({ hasText: "Payer" }).first().click();
    await expect(page.locator('[role="alert"]').first()).toBeVisible({ timeout: 15_000 });
    expect(JSON.stringify(checkoutBody)).not.toContain("commandeId");

    // Aucune commande, aucun billet.
    await page.goto("/#/tickets");
    await expect(page.locator("h1")).toContainText("Mes billets");
    await expect(page.locator("text=Valide")).toHaveCount(0);
  });
});
