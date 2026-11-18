import { expect, test } from "@playwright/test";
import { adminCredentials, ApiSession, paceAuth, randomPassword, saveAdmin, setupToken, uniqueEmail } from "./support";

// Premier fichier exécuté : sur une instance vierge, il déroule l'assistant de
// premier démarrage dans le navigateur (mode test) et retient l'administrateur
// créé pour la suite. Sur une instance déjà initialisée, il vérifie seulement
// que l'assistant est fermé.
test.describe("Assistant de premier démarrage", () => {
  test("instance vierge : jeton, mode test, premier administrateur, puis connexion", async ({ page }) => {
    const api = await ApiSession.open();
    const status = (await api.call("GET", "/setup/status")).body as { etat: string };
    test.skip(status.etat === "pret", "instance déjà initialisée");

    // Tant que l'application n'est pas initialisée, toute adresse mène à l'assistant.
    await page.goto("/#/admin");
    await expect(page.locator("h1")).toContainText("Premier démarrage");
    expect((await api.call("GET", "/events")).status).toBe(503);

    // Un mauvais jeton est refusé et ramène à la première étape.
    const admin = { email: uniqueEmail("admin"), password: randomPassword() };
    const fill = async (jeton: string) => {
      await page.fill("#jeton", jeton);
      await page.getByRole("button", { name: "Continuer" }).click();
      await page.locator('input[name="mode"][value="test"]').check();
      await page.getByRole("button", { name: "Continuer" }).click();
      await page.fill("#prenom", "Ada");
      await page.fill("#nom", "Admin");
      await page.fill("#email", admin.email);
      await page.fill("#password", admin.password);
      await page.fill("#confirmation", admin.password);
      await paceAuth();
      await page.getByRole("button", { name: "Initialiser l'application" }).click();
    };
    await fill("jeton-invente-par-un-attaquant-0000");
    await expect(page.locator('[role="alert"]').first()).toContainText("Jeton", { timeout: 15_000 });
    await expect(page.locator("#jeton")).toBeVisible();

    // Le vrai jeton vient des journaux de démarrage.
    // Identifiants retenus avant l'envoi : une interruption ne les fait pas perdre.
    saveAdmin(admin);
    await fill(setupToken());
    await expect(page.getByTestId("setup-progress")).toBeVisible({ timeout: 15_000 });

    // Chargement des données, création de l'administrateur, redémarrage de l'API.
    await expect(page).toHaveURL(/\/#\/login/, { timeout: 180_000 });
    await expect(page.locator("#email")).toBeVisible({ timeout: 15_000 });
    await page.fill("#email", admin.email);
    await page.fill("#password", admin.password);
    await paceAuth();
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/#\/admin/, { timeout: 20_000 });
    await expect(page.locator("h1")).toContainText("Administration");
    await api.dispose();
  });

  test("instance initialisée : l'assistant n'existe plus", async ({ page }) => {
    const api = await ApiSession.open();
    expect((await api.call("GET", "/setup/status")).body).toMatchObject({ etat: "pret" });

    // La page de l'assistant renvoie à la connexion.
    await page.goto("/#/setup");
    await expect(page).toHaveURL(/\/#\/login/, { timeout: 15_000 });

    // Rejouer l'installation, même avec des données valides, est refusé.
    await paceAuth();
    const replay = await api.call("POST", "/setup", {
      jeton: "jeton-invente-par-un-attaquant-0000",
      mode: "test",
      admin: { email: uniqueEmail("pirate"), password: randomPassword(), prenom: "P", nom: "Irate" },
    });
    expect(replay.status).toBe(409);
    expect(replay.body).toMatchObject({ error: "DEJA_INITIALISEE" });
    expect(adminCredentials().email).toContain("@");
    await api.dispose();
  });
});
