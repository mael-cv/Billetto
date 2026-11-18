import { expect, test } from "@playwright/test";
import { createEvent, goToCheckout, registerAndLogin } from "./support";

// Paiement par carte avec le vrai Stripe (mode test) : la réservation ouvre la
// page de paiement hébergée par Stripe, pour le montant calculé par le serveur.
// La saisie de la carte elle-même (cadres intégrés et captcha de Stripe) n'est pas
// automatisée : elle se vérifie à la main avec la carte 4242 4242 4242 4242.
// Ignoré si aucune clé Stripe de test n'est configurée sur l'instance.
test.describe("Paiement par carte (Stripe, mode test)", () => {
  test("la réservation ouvre la page Stripe au bon montant, sans billet avant paiement", async ({ page }) => {
    const event = await createEvent("Parcours Stripe");
    await registerAndLogin(page, "Zoé", "Carte", "stripe");
    await goToCheckout(page, event.slug);

    // La réponse est lue à l'interception : la page part aussitôt chez Stripe,
    // et le corps ne serait plus lisible après la navigation.
    let captured: { status: number; url: string; text: string } | undefined;
    await page.route(/\/orders\/holds\/\d+\/checkout$/, async (route) => {
      const res = await route.fetch();
      captured = { status: res.status(), url: route.request().url(), text: await res.text() };
      await route.fulfill({ response: res });
    });
    await page.locator("#cgv").check();
    await page.locator('button[type="submit"]').filter({ hasText: "Payer" }).first().click();
    await expect.poll(() => captured?.status, { timeout: 30_000 }).toBeDefined();
    const response = captured!;
    test.skip(response.status === 503, "paiement par carte non configuré sur cette instance");
    expect(response.status).toBe(200);
    const body = JSON.parse(response.text) as { statut: string; url: string };
    expect(body.statut).toBe("paiement");
    expect(response.text).not.toContain("commandeId");
    const reservation = Number(/holds\/(\d+)\/checkout/.exec(response.url)?.[1]);

    // Page de paiement de Stripe : session de test, montant du serveur (20,00 €).
    await expect(page).toHaveURL(/^https:\/\/checkout\.stripe\.com\/.*cs_test_/, { timeout: 30_000 });
    await expect(page.locator("body")).toContainText(/20[.,]00/, { timeout: 30_000 });

    // Abandon du paiement : retour sur le site, la réservation reste impayée et sans billet.
    await page.goto(`/#/checkout/success?reservation=${reservation}&retour=annule`);
    await expect(page.getByTestId("payment-pending")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("h1")).toContainText("Paiement non finalisé");
    const hold = (await (await page.request.get(`/api/v1/orders/holds/${reservation}`)).json()) as { statut: string; commandeId: number | null };
    expect(hold).toMatchObject({ statut: "active", commandeId: null });
    const tickets = (await (await page.request.get("/api/v1/tickets/me")).json()) as { total: number };
    expect(tickets.total).toBe(0);

    // L'acheteur libère ses places.
    await page.getByRole("button", { name: "Annuler la réservation" }).click();
    await expect(page).toHaveURL(/\/#\/events/, { timeout: 15_000 });
  });
});
