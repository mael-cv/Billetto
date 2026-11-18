import { expect, test } from "@playwright/test";
import { adminCredentials, ApiSession, createEvent, createOrganizer, goToCheckout, login, registerAndLogin } from "./support";

test.describe("Parcours Organisateur", () => {
  test("tableau de bord (RLS), événements, et validation d'un virement reçu", async ({ page, browser }) => {
    // Un événement et son organisateur (compte promu par l'administrateur).
    const event = await createEvent("Parcours organisateur");
    const organizer = await createOrganizer(event.organisateurId);

    // Un acheteur réserve par virement (autre session de navigateur).
    const buyerContext = await browser.newContext({ ignoreHTTPSErrors: true });
    const buyer = await buyerContext.newPage();
    await registerAndLogin(buyer, "Bao", "Acheteur", "virement");
    await goToCheckout(buyer, event.slug);
    await buyer.locator('input[name="modePaiement"][value="virement"]').check();
    await buyer.locator("#cgv").check();
    await buyer.locator('button[type="submit"]').filter({ hasText: "Payer" }).first().click();
    await expect(buyer).toHaveURL(/awaiting-transfer\?reservation=\d+/, { timeout: 15_000 });
    const reservation = Number(/reservation=(\d+)/.exec(buyer.url())?.[1]);

    // L'acheteur ne peut pas valider lui-même son virement.
    const buyerApi = await buyer.request.post(`/api/v1/orders/holds/${reservation}/validate-transfer`, {
      headers: { "x-csrf-token": (await buyerContext.cookies()).find((c) => c.name === "billetto_csrf")?.value ?? "" },
    });
    expect(buyerApi.status()).toBe(403);

    // 1. Connexion de l'organisateur : redirection vers son espace
    await login(page, organizer);
    await expect(page).toHaveURL(/\/#\/organizer/, { timeout: 15_000 });

    // 2. Tableau de bord : statistiques de ses événements uniquement
    await expect(page.locator("h1")).toContainText("Tableau de bord");
    const stats = page.locator('[data-testid="stats"]');
    await expect(stats).toBeVisible({ timeout: 15_000 });
    await expect(stats).toContainText("Chiffre d'affaires");

    // 3. Virement en attente : validation depuis le tableau de bord, billets émis
    const row = page.getByTestId(`transfer-${reservation}`);
    await expect(row).toBeVisible({ timeout: 15_000 });
    page.once("dialog", (dialog) => void dialog.accept());
    await row.getByRole("button", { name: "Valider le virement" }).click();
    await expect(row).toBeHidden({ timeout: 15_000 });
    await buyer.goto("/#/tickets");
    await buyer.reload(); // la liste est mise en cache 30 s côté navigateur
    await expect(buyer.locator("text=Valide").first()).toBeVisible({ timeout: 15_000 });
    await buyerContext.close();

    // 4. Mes événements
    await page.goto("/#/organizer/events");
    await expect(page.locator("h1")).toContainText("Mes événements");
    await expect(page.locator('[data-testid="organizer-events"], table').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("text=Parcours organisateur").first()).toBeVisible();

    // 5. Un organisateur d'un autre collectif ne voit ni l'événement ni le virement.
    const other = await createEvent("Autre collectif", "Autre organisateur", event.organisateurId);
    const rival = await ApiSession.loggedIn(await createOrganizer(other.organisateurId));
    expect((await rival.call("PATCH", `/events/${event.id}`, { nom: "Piraté" })).status).toBe(404);
    const transfers = (await rival.call("GET", "/orders/holds/transfers")).body as { evenementId: number }[];
    expect(transfers.every((t) => t.evenementId !== event.id)).toBe(true);
    await rival.dispose();
    expect(adminCredentials().email).toContain("@");
  });
});
