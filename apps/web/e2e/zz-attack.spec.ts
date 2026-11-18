import { type ConsoleMessage, expect, type Page, test } from "@playwright/test";
import {
  adminApi,
  adminCredentials,
  ApiSession,
  BASE_URL,
  createEvent,
  createOrganizer,
  goToCheckout,
  login,
  payByValidatedTransfer,
  randomPassword,
  registerAndLogin,
  type TestEvent,
} from "./support";

// Tentatives d'attaque dans le navigateur, contre l'instance déployée. Chaque
// test décrit ce qu'un attaquant essaie ; il réussit quand l'attaque échoue.

// Charges XSS : si l'une d'elles s'exécute, window.__xss est défini (ou une boîte de dialogue s'ouvre).
const XSS = {
  img: `<img src=x onerror="window.__xss='img'">`,
  script: `"><script>window.__xss='script'</script>`,
  svg: `<svg onload="window.__xss='svg'"></svg>`,
  attr: `" onmouseover="window.__xss='attr'" x="`,
  link: `<a href="javascript:window.__xss='lien'">cliquez</a>`,
};

/** Surveille une page : aucune boîte de dialogue, aucun script injecté, aucune violation « script-src ». */
function watch(page: Page) {
  const problems: string[] = [];
  page.on("dialog", (dialog) => {
    problems.push(`boîte de dialogue : ${dialog.message()}`);
    void dialog.dismiss();
  });
  page.on("console", (message: ConsoleMessage) => {
    if (/Content Security Policy/i.test(message.text()) && /script-src|inline/i.test(message.text())) {
      problems.push(`CSP : ${message.text().slice(0, 160)}`);
    }
  });
  return {
    async assertClean(label: string) {
      // Laisse le temps à un éventuel gestionnaire d'événement de se déclencher.
      await page.waitForTimeout(500);
      const state = await page.evaluate(() => ({
        xss: (window as unknown as { __xss?: string }).__xss ?? null,
        handlers: document.querySelectorAll("[onerror],[onload],[onmouseover],[onclick]").length,
        inlineScripts: [...document.querySelectorAll("script")].filter((s) => !s.src).length,
        javascriptLinks: [...document.querySelectorAll("a[href]")].filter((a) => /^\s*javascript:/i.test(a.getAttribute("href") ?? "")).length,
      }));
      expect(state, `${label} : charge exécutée ou injectée dans le DOM`).toEqual({
        xss: null,
        handlers: 0,
        inlineScripts: 0,
        javascriptLinks: 0,
      });
      expect(problems, `${label} : ${problems.join(" | ")}`).toEqual([]);
    },
  };
}

test.describe("Attaques dans le navigateur", () => {
  let event: TestEvent;

  test.beforeAll(async () => {
    // Nom et description d'événement piégés (saisis par un organisateur malveillant).
    event = await createEvent(`Concert ${XSS.img}`, `Description ${XSS.script} ${XSS.svg}`);
  });

  test("XSS stocké : nom, avis, réponse, page éditoriale — rien ne s'exécute", async ({ page }) => {
    const guard = watch(page);
    const admin = await adminApi();

    // Page éditoriale piégée. Les URL de média « javascript: » et « data: » sont refusées par l'API.
    const page_ = {
      templateId: "concert",
      tags: [XSS.img.slice(0, 30)],
      programme: [{ heure: new Date(Date.now() + 30 * 86_400_000).toISOString(), scene: XSS.svg, titre: XSS.script, artiste: XSS.img, dureeMin: 45 }],
      medias: [{ type: "image", url: "https://images.unsplash.com/photo-1", legende: XSS.attr }],
      sections: [{ title: XSS.script, content: `${XSS.img} ${XSS.link}` }],
      faq: [{ question: XSS.svg, answer: XSS.link }],
    };
    for (const url of ["javascript:alert(1)", "data:text/html,<script>alert(1)</script>", "//evil.example/x.js"]) {
      const refused = await admin.call("PUT", `/events/${event.id}/page`, { ...page_, medias: [{ type: "image", url }] });
      expect(refused.status, `URL de média ${url}`).toBe(400);
    }
    expect((await admin.call("PUT", `/events/${event.id}/page`, page_)).status).toBe(200);

    // Acheteur au nom piégé, avec un avis piégé.
    const buyer = await registerAndLogin(page, XSS.img, XSS.script, "xss");
    await goToCheckout(page, event.slug);
    await guard.assertClean("page de paiement");
    await payByValidatedTransfer(page);
    const session = await ApiSession.loggedIn(buyer);
    const review = await session.call("POST", `/events/${event.id}/avis`, { note: 5, titre: XSS.svg, commentaire: `${XSS.img} ${XSS.script} ${XSS.link}` });
    expect(review.status).toBe(201);
    // Réponse piégée de l'organisateur (ici l'administrateur).
    const reply = await admin.call("POST", `/avis/${(review.body as { id: string }).id}/reponse`, { texte: `${XSS.script} ${XSS.img}` });
    expect(reply.status).toBe(200);
    await session.dispose();

    // Les charges sont affichées comme du texte sur toutes les pages qui les montrent.
    await page.goto(`/#/events/${event.slug}`);
    await expect(page.getByTestId("review-item").first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("body")).toContainText("window.__xss");
    await guard.assertClean("fiche de l'événement (page éditoriale, avis, réponse)");

    await page.goto("/#/tickets");
    await expect(page.locator("text=Valide").first()).toBeVisible({ timeout: 15_000 });
    await guard.assertClean("mes billets");

    await page.goto("/#/account");
    await guard.assertClean("mon compte");

    await page.goto(`/#/events?q=${encodeURIComponent("Concert <img")}`);
    await guard.assertClean("catalogue (recherche reflétée)");

    // Vue d'administration : la liste des utilisateurs affiche le nom piégé.
    await page.goto("/#/account");
    await page.locator('button:has-text("Se déconnecter")').first().click();
    await expect(page).toHaveURL(/\/#\/$/, { timeout: 15_000 });
    await login(page, adminCredentials());
    await expect(page.locator("table").first()).toBeVisible({ timeout: 15_000 });
    await guard.assertClean("administration (utilisateurs)");
    await page.goto("/#/organizer/avis");
    await expect(page.locator("h1")).toContainText("Avis");
    await guard.assertClean("avis reçus (gestion)");
    await page.goto("/#/organizer/events");
    await guard.assertClean("événements (gestion)");
  });

  test("XSS reflété et paramètres d'URL : rien n'est interprété", async ({ page }) => {
    const guard = watch(page);
    for (const hash of [
      `/#/events?q=${encodeURIComponent(XSS.script)}`,
      `/#/events/${encodeURIComponent(XSS.img)}`,
      `/#/checkout/success?commande=${encodeURIComponent(XSS.svg)}`,
      `/#/checkout/awaiting-transfer?reservation=1&expireA=2030-01-01&event=${encodeURIComponent(XSS.img)}&tarif=${encodeURIComponent(XSS.script)}&montant=${encodeURIComponent(XSS.svg)}`,
      `/#/${encodeURIComponent(XSS.script)}`,
    ]) {
      await page.goto(hash);
      await guard.assertClean(hash.slice(0, 40));
    }
  });

  test("redirection ouverte après connexion : toujours une page du site", async ({ page }) => {
    const user = { email: `redir-${Date.now()}@billetto.test`, password: randomPassword() };
    const session = await ApiSession.open();
    expect((await session.register(user, "Rémi", "Redirigé")).status).toBe(201);
    await session.dispose();
    for (const next of ["https://evil.example/", "//evil.example/", "javascript:alert(1)", "/\\evil.example"]) {
      await page.context().clearCookies();
      await page.goto(`/#/login?next=${encodeURIComponent(next)}`);
      await page.waitForSelector("#email");
      await page.fill("#email", user.email);
      await page.fill("#password", user.password);
      await (await import("./support")).paceAuth();
      await page.click('button[type="submit"]');
      await expect(page).not.toHaveURL(/\/#\/login/, { timeout: 15_000 });
      expect(new URL(page.url()).origin, `next=${next}`).toBe(new URL(BASE_URL).origin);
    }
  });

  test("cookies de session, stockage du navigateur et déconnexion", async ({ page, context }) => {
    await registerAndLogin(page, "Sam", "Session", "cookies");

    // Le jeton de session est inaccessible au JavaScript et ne voyage qu'en HTTPS, sur ce site.
    const cookies = await context.cookies();
    const session = cookies.find((c) => c.name === "billetto_session");
    expect(session).toMatchObject({ httpOnly: true, secure: true, sameSite: "Strict" });
    expect(await page.evaluate(() => document.cookie)).not.toContain("billetto_session");

    // Aucun jeton ni donnée personnelle dans le stockage du navigateur.
    const storage = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
    expect(storage).not.toMatch(/eyJ|password|billetto_session/i);

    // Données de check-in laissées par un précédent utilisateur de l'appareil : effacées à la déconnexion.
    await page.evaluate(() => {
      localStorage.setItem("billetto:checkin:1", JSON.stringify({ pending: [{ payload: "BT1.secret" }], scanned: [] }));
      localStorage.setItem("billetto:checkin-manifest:1", JSON.stringify([{ codeVerification: "secret" }]));
    });
    const stolen = session?.value ?? "";
    await page.goto("/#/account");
    await page.locator('button:has-text("Se déconnecter")').first().click();
    await expect(page).toHaveURL(/\/#\/$/, { timeout: 15_000 });
    const left = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("billetto:checkin")));
    expect(left.filter((k) => k !== "billetto:checkin-device")).toEqual([]);

    // Le jeton copié avant la déconnexion ne vaut plus rien.
    await context.addCookies([{ name: "billetto_session", value: stolen, url: BASE_URL, httpOnly: true, secure: true, sameSite: "Strict" }]);
    expect((await page.request.get("/api/v1/auth/me")).status()).toBe(401);
  });

  test("gardes d'interface contournées : l'API refuse quand même", async ({ page, context }) => {
    await registerAndLogin(page, "Vera", "Visiteuse", "gardes");
    const csrf = (await context.cookies()).find((c) => c.name === "billetto_csrf")?.value ?? "";

    // Pages réservées : écran de refus.
    for (const route of ["/#/admin", "/#/organizer", "/#/checkin", "/#/organizer/events/new", "/#/organizer/avis"]) {
      await page.goto(route);
      await expect(page.locator("h1")).toContainText("Accès réservé", { timeout: 15_000 });
    }

    // Appels directs à l'API avec la session du visiteur.
    const attempts: [string, string, unknown?][] = [
      ["GET", "/users"],
      ["PATCH", "/users/1/role", { role: "admin", organisateurId: null }],
      ["GET", "/analytics/summary"],
      ["GET", "/analytics/price-audit"],
      ["GET", "/orders/holds/transfers"],
      ["GET", `/checkin/manifest?evenementId=${event.id}`],
      ["GET", `/events/${event.id}/participants/export`],
      ["DELETE", "/activites?avant=2000-01-01"],
      ["DELETE", `/events/${event.id}`],
      ["PATCH", `/events/${event.id}`, { nom: "Piraté" }],
    ];
    for (const [method, path, data] of attempts) {
      const res = await page.request.fetch(`/api/v1${path}`, { method, data, headers: { "x-csrf-token": csrf } });
      expect(res.status(), `${method} ${path}`).toBe(403);
    }
    // L'événement est intact.
    await page.goto(`/#/events/${event.slug}`);
    await expect(page.locator("h1").first()).toContainText("Concert");
  });

  test("organisateur d'un autre collectif : page de gestion et données inaccessibles", async ({ page }) => {
    const other = await createEvent("Collectif rival", "Autre organisateur", event.organisateurId);
    const rival = await createOrganizer(other.organisateurId);
    await login(page, rival);

    // Il tente d'ouvrir la page de gestion de l'événement d'un autre.
    await page.goto(`/#/organizer/events/${event.id}/page`);
    await expect(page.locator("body")).not.toContainText("Concert <img", { timeout: 15_000 });
    const csrf = (await page.context().cookies()).find((c) => c.name === "billetto_csrf")?.value ?? "";
    for (const [method, path, data] of [
      ["PATCH", `/events/${event.id}`, { nom: "Piraté" }],
      ["DELETE", `/events/${event.id}`, undefined],
      ["PUT", `/events/${event.id}/page`, { templateId: "concert", tags: [], programme: [], medias: [], sections: [], faq: [] }],
      ["PATCH", `/prices/${event.tarifId}`, { prix: 0 }],
    ] as [string, string, unknown][]) {
      const res = await page.request.fetch(`/api/v1${path}`, { method, data, headers: { "x-csrf-token": csrf } });
      expect(res.status(), `${method} ${path}`).toBe(404);
    }
    for (const path of [`/events/${event.id}/participants/export`, `/checkin/manifest?evenementId=${event.id}`]) {
      expect((await page.request.get(`/api/v1${path}`)).status(), path).toBe(403);
    }
  });

  test("clickjacking et en-têtes : le site ne s'affiche pas dans un cadre", async ({ page }) => {
    const response = await page.request.get("/");
    const headers = response.headers();
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["content-security-policy"]).toContain("script-src 'self'");
    expect(headers["strict-transport-security"]).toBeTruthy();
    expect(headers["x-content-type-options"]).toBe("nosniff");

    // Une page tierce tente d'encadrer le site : le navigateur refuse de le charger.
    await page.route("https://evil.example/**", (route) =>
      route.fulfill({ contentType: "text/html", body: `<iframe id="cible" src="${BASE_URL}/" width="800" height="600"></iframe>` }),
    );
    await page.goto("https://evil.example/piege");
    await page.waitForTimeout(1_500);
    const framed = page.frames().find((f) => f.url().startsWith(BASE_URL));
    const content = framed ? await framed.content().catch(() => "") : "";
    expect(content).not.toContain("Billetto");
  });
});
