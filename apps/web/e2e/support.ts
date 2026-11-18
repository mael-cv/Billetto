import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type APIRequestContext, expect, type Page, request } from "@playwright/test";

export const BASE_URL = process.env.BASE_URL ?? "https://localhost:3000";
const COMPOSE_PROJECT = process.env.COMPOSE_PROJECT ?? "billetto";

// État local de l'exécution (identifiants de l'administrateur créé par l'assistant).
// Fichier ignoré par git, propre à une instance : jamais d'identifiant dans le dépôt.
const STATE_FILE = join(dirname(fileURLToPath(import.meta.url)), ".state", "admin.json");

export interface Credentials {
  email: string;
  password: string;
}

/** Mot de passe aléatoire conforme à la politique (12 caractères minimum, variés). */
export const randomPassword = (): string => `Pw7-${randomBytes(15).toString("base64url")}`;
export const uniqueEmail = (prefix: string): string => `${prefix}-${Date.now()}-${randomBytes(3).toString("hex")}@billetto.test`;

export function saveAdmin(credentials: Credentials): void {
  mkdirSync(dirname(STATE_FILE), { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify({ ...credentials, baseUrl: BASE_URL }), { mode: 0o600 });
}

export function adminCredentials(): Credentials {
  if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
    return { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD };
  }
  if (existsSync(STATE_FILE)) {
    const state = JSON.parse(readFileSync(STATE_FILE, "utf-8")) as Credentials & { baseUrl: string };
    if (state.baseUrl === BASE_URL) return { email: state.email, password: state.password };
  }
  throw new Error("Administrateur inconnu : lancez d'abord 00-setup sur une instance vierge, ou fournissez ADMIN_EMAIL et ADMIN_PASSWORD.");
}

/** Jeton d'installation courant, lu dans les journaux Docker (seul canal prévu). */
export function setupToken(): string {
  const logs = (service: string) =>
    execFileSync("docker", ["compose", "-p", COMPOSE_PROJECT, "logs", "--no-color", service], { encoding: "utf-8" }).replace(
      // eslint-disable-next-line no-control-regex
      /\u001b\[[0-9;]*m/g,
      "",
    );
  const regenerated = [...logs("api").matchAll(/nouveau jeton émis → ([A-Za-z0-9_-]{30,})/g)].pop()?.[1];
  if (regenerated) return regenerated;
  const initial = /jeton d'installation :\s*(?:\S+\s*\|\s*)*([A-Za-z0-9_-]{30,})/.exec(logs("bootstrap"))?.[1];
  if (!initial) throw new Error(`Jeton d'installation introuvable dans les journaux du projet « ${COMPOSE_PROJECT} ».`);
  return initial;
}

// ---------------------------------------------------------------------------
// Limite de débit : login, register, password et l'assistant partagent un
// compteur de 10 requêtes par minute et par adresse. Les parcours s'y conforment
// (compteur persistant entre les fichiers de test).
// ---------------------------------------------------------------------------
const PACE_FILE = join(tmpdir(), `billetto-e2e-auth-${Buffer.from(BASE_URL).toString("hex").slice(0, 24)}.json`);
const AUTH_BUDGET = 8;

export async function paceAuth(calls = 1): Promise<void> {
  for (let i = 0; i < calls; i++) {
    for (;;) {
      const now = Date.now();
      let stamps: number[] = [];
      try {
        stamps = (JSON.parse(readFileSync(PACE_FILE, "utf-8")) as number[]).filter((t) => now - t < 61_000);
      } catch {
        stamps = [];
      }
      if (stamps.length < AUTH_BUDGET) {
        writeFileSync(PACE_FILE, JSON.stringify([...stamps, now]));
        break;
      }
      await new Promise((r) => setTimeout(r, 61_000 - (now - Math.min(...stamps)) + 500));
    }
  }
}

// ---------------------------------------------------------------------------
// Session d'API (préparation des données et attaques directes, hors navigateur)
// ---------------------------------------------------------------------------
export class ApiSession {
  private csrf = "";
  private constructor(private readonly context: APIRequestContext) {}

  static async open(): Promise<ApiSession> {
    const session = new ApiSession(await request.newContext({ baseURL: BASE_URL, ignoreHTTPSErrors: true }));
    await session.refreshCsrf();
    return session;
  }

  static async loggedIn(credentials: Credentials): Promise<ApiSession> {
    const session = await ApiSession.open();
    const res = await session.login(credentials);
    if (res.status !== 200) throw new Error(`connexion ${credentials.email} : ${res.status}`);
    return session;
  }

  private async refreshCsrf(): Promise<void> {
    const res = await this.context.get("/api/v1/auth/csrf");
    this.csrf = ((await res.json()) as { csrfToken: string }).csrfToken;
  }

  async login(credentials: Credentials) {
    await paceAuth();
    const res = await this.call("POST", "/auth/login", credentials);
    if (res.status === 200) this.csrf = (res.body as { csrfToken: string }).csrfToken;
    return res;
  }

  async register(credentials: Credentials, prenom: string, nom: string) {
    await paceAuth();
    return this.call("POST", "/auth/register", { ...credentials, prenom, nom });
  }

  async call(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, data?: unknown, headers: Record<string, string> = {}) {
    const res = await this.context.fetch(`/api/v1${path}`, {
      method,
      data,
      headers: { ...(method === "GET" ? {} : { "x-csrf-token": this.csrf }), ...headers },
    });
    const text = await res.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // réponse non JSON (204, CSV…)
    }
    return { status: res.status(), body, headers: res.headers() };
  }

  dispose(): Promise<void> {
    return this.context.dispose();
  }
}

let adminSession: Promise<ApiSession> | null = null;
/** Session d'API de l'administrateur, ouverte une seule fois par exécution. */
export function adminApi(): Promise<ApiSession> {
  adminSession ??= ApiSession.loggedIn(adminCredentials());
  return adminSession;
}

// ---------------------------------------------------------------------------
// Parcours dans le navigateur
// ---------------------------------------------------------------------------
export async function login(page: Page, credentials: Credentials): Promise<void> {
  await page.goto("/#/login");
  await page.waitForSelector("#email");
  await page.fill("#email", credentials.email);
  await page.fill("#password", credentials.password);
  await paceAuth();
  await page.click('button[type="submit"]');
  await expect(page).not.toHaveURL(/\/#\/login/, { timeout: 15_000 });
}

/** Inscription (qui n'ouvre pas de session) puis connexion avec les mêmes identifiants. */
export async function registerAndLogin(page: Page, prenom: string, nom: string, prefix = "visiteur"): Promise<Credentials> {
  const credentials = { email: uniqueEmail(prefix), password: randomPassword() };
  await page.goto("/#/register");
  await page.waitForSelector("#prenom");
  await page.fill("#prenom", prenom);
  await page.fill("#nom", nom);
  await page.fill("#email", credentials.email);
  await page.fill("#password", credentials.password);
  await paceAuth();
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/#\/login/, { timeout: 15_000 });
  await login(page, credentials);
  return credentials;
}

/** Ouvre la fiche d'un événement à venir et ajoute un billet au panier, jusqu'à la page de paiement. */
export async function goToCheckout(page: Page, slug: string): Promise<void> {
  await page.goto(`/#/events/${slug}`);
  const add = page.locator('button[aria-label="Ajouter"]:not([disabled])').first();
  await expect(add).toBeVisible({ timeout: 15_000 });
  await add.click();
  const next = page.locator('button:has-text("Continuer")').first();
  await expect(next).toBeEnabled();
  await next.click();
  await expect(page).toHaveURL(/\/#\/checkout/);
}

/**
 * Depuis la page de paiement : règle la commande par virement, puis
 * l'administrateur valide la réception des fonds. Le paiement par carte passe
 * par la page hébergée de Stripe et n'est pas automatisé ici ; l'émission des
 * billets suit le même chemin côté serveur.
 */
export async function payByValidatedTransfer(page: Page): Promise<number> {
  await page.locator('input[name="modePaiement"][value="virement"]').check();
  await page.locator("#cgv").check();
  await page.locator('button[type="submit"]').filter({ hasText: "Payer" }).first().click();
  await expect(page).toHaveURL(/\/#\/checkout\/awaiting-transfer\?reservation=\d+/, { timeout: 15_000 });
  const reservation = Number(/reservation=(\d+)/.exec(page.url())?.[1]);
  const admin = await adminApi();
  const res = await admin.call("POST", `/orders/holds/${reservation}/validate-transfer`);
  expect(res.status).toBe(200);
  return reservation;
}

export interface TestEvent {
  id: number;
  slug: string;
  tarifId: number;
  organisateurId: number;
}

/** Événement à venir, publié, avec un tarif ouvert, créé par l'administrateur pour un organisateur existant. */
export async function createEvent(nom: string, description = "Événement créé par les tests", skipOrganisateur?: number): Promise<TestEvent> {
  const admin = await adminApi();
  const list = (await admin.call("GET", "/events?pageSize=30")).body as { items: { id: number }[] };
  let source: { organisateurId: number; lieu: { id: number }; type: { id: number } } | null = null;
  for (const item of list.items) {
    const detail = (await admin.call("GET", `/events/${item.id}`)).body as NonNullable<typeof source>;
    if (detail.organisateurId !== skipOrganisateur) {
      source = detail;
      break;
    }
  }
  if (!source) throw new Error("Aucun événement de démonstration : instance en mode test attendue.");

  const slug = `e2e-${Date.now()}-${randomBytes(3).toString("hex")}`;
  const day = 86_400_000;
  const created = await admin.call("POST", "/events", {
    nom,
    slug,
    description,
    debut: new Date(Date.now() + 30 * day).toISOString(),
    fin: new Date(Date.now() + 30 * day + 3 * 3_600_000).toISOString(),
    lieuId: source.lieu.id,
    typeEvenementId: source.type.id,
    organisateurId: source.organisateurId,
  });
  expect(created.status).toBe(201);
  const id = (created.body as { id: number }).id;
  const price = await admin.call("POST", `/events/${id}/prices`, {
    nom: "Standard",
    prix: 20,
    quota: 50,
    dateDebutVente: new Date(Date.now() - day).toISOString(),
    dateFinVente: new Date(Date.now() + 29 * day).toISOString(),
  });
  expect(price.status).toBe(201);
  expect((await admin.call("PATCH", `/events/${id}`, { statut: "published" })).status).toBe(200);
  return { id, slug, tarifId: (price.body as { id: number }).id, organisateurId: source.organisateurId };
}

/** Compte organisateur rattaché au collectif indiqué (promu par l'administrateur). */
export async function createOrganizer(organisateurId: number): Promise<Credentials> {
  const credentials = { email: uniqueEmail("orga"), password: randomPassword() };
  const session = await ApiSession.open();
  expect((await session.register(credentials, "Olga", "Organisatrice")).status).toBe(201);
  const admin = await adminApi();
  const users = (await admin.call("GET", `/users?q=${encodeURIComponent(credentials.email)}`)).body as { items: { id: number }[] };
  const res = await admin.call("PATCH", `/users/${users.items[0]?.id}/role`, { role: "organizer", organisateurId });
  expect(res.status).toBe(200);
  await session.dispose();
  return credentials;
}
