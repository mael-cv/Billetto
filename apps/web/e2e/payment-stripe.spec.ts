import { expect, test } from "@playwright/test";
import { createEvent, goToCheckout, registerAndLogin } from "./support";

// Paiement par carte de bout en bout, sur la page hébergée par Stripe (mode test) :
// réservation, paiement avec la carte de test, webhook relayé, billet émis.
// Ignoré si aucune clé Stripe de test n'est configurée sur l'instance.
test.describe("Paiement par carte (Stripe, mode test)", () => {
  test("carte 4242 : le billet est émis après confirmation de Stripe", async ({ page }) => {
    const event = await createEvent("Parcours Stripe");
    await registerAndLogin(page, "Zoé", "Carte", "stripe");
    await goToCheckout(page, event.slug);

    const checkout = page.waitForResponse((r) => /\/orders\/holds\/\d+\/checkout$/.test(r.url()));
    await page.locator("#cgv").check();
    await page.locator('button[type="submit"]').filter({ hasText: "Payer" }).first().click();
    const response = await checkout;
    test.skip(response.status() === 503, "paiement par carte non configuré sur cette instance");
    expect(response.status()).toBe(200);

    // Page de paiement de Stripe : le montant affiché vient du serveur (20,00 €).
    await expect(page).toHaveURL(/^https:\/\/checkout\.stripe\.com\//, { timeout: 30_000 });
    await expect(page.locator("body")).toContainText("20,00", { timeout: 30_000 });
    await page.locator("#cardNumber").fill("4242 4242 4242 4242");
    await page.locator("#cardExpiry").fill("12 / 34");
    await page.locator("#cardCvc").fill("123");
    await page.locator("#billingName").fill("Zoe Carte");
    await page.locator('[data-testid="hosted-payment-submit-button"]').click();

    // Retour sur le site : la commande n'apparaît qu'une fois le webhook reçu et vérifié.
    await expect(page).toHaveURL(/\/#\/checkout\/success\?reservation=\d+/, { timeout: 60_000 });
    await expect(page.locator("h1")).toContainText("Commande confirmée", { timeout: 60_000 });
    await expect(page.getByTestId("order-id")).toBeVisible();

    await page.goto("/#/tickets");
    await page.reload();
    await expect(page.locator("text=Valide").first()).toBeVisible({ timeout: 15_000 });
  });
});
