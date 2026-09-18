import { expect, test } from "@playwright/test";

test.describe("Parcours Utilisateur (visiteur -> inscription -> achat -> billet -> remboursement)", () => {
  test("inscription, découverte, achat d'un billet, consultation et remboursement", async ({ page }) => {
    const timestamp = Date.now();
    const email = `visiteur-${timestamp}@test.billetto.local`;

    // 1. Inscription
    await page.goto("/#/register");
    await page.waitForSelector("#prenom");
    await page.fill("#prenom", "Alice");
    await page.fill("#nom", "Dupont");
    await page.fill("#email", email);
    await page.fill("#password", "Password12345!");
    await page.click('button[type="submit"]');

    // Redirection automatique (vers /tickets ou /)
    await expect(page).toHaveURL(/\/#\/(tickets|$)/);

    // 2. Découverte du catalogue (recherche d'un événement à venir avec billets)
    await page.goto("/#/events?q=Tour");
    await expect(page.locator("h1")).toContainText("Découvrir");

    const eventCard = page.locator('a[href^="#/events/"]:not(:has-text("Terminé"))').first();
    await expect(eventCard).toBeVisible({ timeout: 10_000 });
    await eventCard.click();

    // 3. Page détail événement
    await expect(page).toHaveURL(/\/#\/events\/.+/);

    // Sélectionner 1 billet via le bouton Ajouter d'un tarif disponible
    const addBtn = page.locator('button[aria-label="Ajouter"]:not([disabled])').first();
    await expect(addBtn).toBeVisible({ timeout: 8_000 });
    await addBtn.click();

    // Cliquer sur Continuer
    const continueBtn = page.locator('button:has-text("Continuer")').first();
    await expect(continueBtn).toBeEnabled({ timeout: 5_000 });
    await continueBtn.click();

    // 4. Page checkout
    await expect(page).toHaveURL(/\/#\/checkout/);
    await expect(page.locator("h1")).toContainText("Paiement");

    // Cocher les conditions générales de vente
    const cgv = page.locator("#cgv");
    await cgv.check();

    // Valider le paiement
    const payBtn = page.locator('button[type="submit"]').filter({ hasText: "Payer" }).first();
    await expect(payBtn).toBeEnabled();
    await payBtn.click();

    // 5. Page succès
    await expect(page).toHaveURL(/\/#\/checkout\/success\?commande=\d+/, { timeout: 10_000 });
    await expect(page.locator("h1")).toContainText("Commande confirmée");

    // 6. Mes billets
    const seeTicketsBtn = page.locator('a[href="#/tickets"]').first();
    await seeTicketsBtn.click();

    await expect(page).toHaveURL(/\/#\/tickets/);
    await expect(page.locator("h1")).toContainText("Mes billets");

    // Billet visible avec badge "Valide"
    await expect(page.locator("text=Valide").first()).toBeVisible({ timeout: 10_000 });

    // 7. Remboursement de la commande
    const refundBtn = page.locator('button:has-text("Rembourser")').first();
    await expect(refundBtn).toBeVisible({ timeout: 10_000 });
    await refundBtn.click();

    // Vérifier que le statut passe à Remboursé
    await expect(page.locator("text=Remboursé").first()).toBeVisible({ timeout: 10_000 });
  });
});
