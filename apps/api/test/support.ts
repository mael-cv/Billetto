import { createHmac, randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { HttpStatus } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { hash } from '@node-rs/argon2';
import { PrismaClient } from '@prisma/client';
import { createApp } from '../src/app.factory';
import { type AppConfig, loadConfig } from '../src/common/config/config';
import { ApiError } from '../src/common/errors/http-errors';
import {
  type CheckoutRequest,
  type CheckoutSession,
  type PaidSession,
  PAYMENT_GATEWAY,
  type PaymentGateway,
} from '../src/modules/payments/domain/payment-gateway';

try {
  process.loadEnvFile(resolve(__dirname, '../../../.env'));
} catch {
  // variables déjà présentes (CI)
}

export const RUN = `${Date.now()}`;
// Mot de passe des comptes créés par les tests : aléatoire à chaque exécution, jamais écrit dans le dépôt.
export const TEST_PASSWORD = `Aa1-${randomBytes(15).toString('base64url')}`;

// Secrets Stripe éphémères : les tests n'appellent jamais Stripe (passerelle remplacée).
export const WEBHOOK_SECRET = `whsec_${randomBytes(24).toString('hex')}`;

export function testConfig(overrides: Partial<Record<keyof AppConfig, string>> = {}): AppConfig {
  return loadConfig({
    ...process.env,
    NODE_ENV: 'test',
    APP_MODE: 'test',
    LOG_LEVEL: 'silent',
    COOKIE_SECURE: 'true',
    CORS_ORIGIN: 'http://localhost:3000',
    TRUST_PROXY: '0',
    RATE_LIMIT_MAX: '100000',
    RATE_LIMIT_AUTH_MAX: '100000',
    RATE_LIMIT_SENSITIVE_MAX: '100000',
    STRIPE_SECRET_KEY: `sk_test_${randomBytes(16).toString('hex')}`,
    STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    // Le job d'e-mails ne tourne pas pendant les tests : l'outbox est vérifiée en base.
    EMAIL_OUTBOX_INTERVAL_MS: '0',
    ...overrides,
  });
}

export async function startApp(config = testConfig()): Promise<NestFastifyApplication> {
  const app = await createApp(config);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

/**
 * Double en mémoire du prestataire de paiement. Une session n'est « payée » que
 * si le test l'a décidé (pay) : c'est ce que l'API relit avant d'émettre des billets.
 */
export class FakeGateway implements PaymentGateway {
  readonly sessions = new Map<string, PaidSession>();
  readonly requests: CheckoutRequest[] = [];

  createCheckoutSession(request: CheckoutRequest): Promise<CheckoutSession> {
    const id = `cs_test_${randomBytes(16).toString('hex')}`;
    this.requests.push(request);
    this.sessions.set(id, {
      id,
      paid: false,
      amountTotal: request.amountCents,
      currency: 'eur',
      reservationId: request.reservationId,
      userId: request.userId,
      evenementId: request.evenementId,
    });
    return Promise.resolve({ id, url: `https://checkout.stripe.com/c/pay/${id}` });
  }

  retrieveSession(sessionId: string): Promise<PaidSession> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return Promise.reject(
        new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'SESSION_PAIEMENT_INVALIDE', 'Session de paiement invalide'),
      );
    }
    return Promise.resolve({ ...session });
  }

  /** Le client a payé sur la page du prestataire. */
  pay(sessionId: string, patch: Partial<PaidSession> = {}): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`session inconnue : ${sessionId}`);
    this.sessions.set(sessionId, { ...session, paid: true, ...patch });
  }
}

/** Remplace les appels réseau de la passerelle de l'application par le double. */
export function installFakeGateway(app: NestFastifyApplication): FakeGateway {
  const fake = new FakeGateway();
  const real = app.get<PaymentGateway>(PAYMENT_GATEWAY);
  real.createCheckoutSession = (request) => fake.createCheckoutSession(request);
  real.retrieveSession = (sessionId) => fake.retrieveSession(sessionId);
  return fake;
}

export const sessionIdOf = (url: string): string => url.slice(url.lastIndexOf('/') + 1);

/** En-tête Stripe-Signature valide pour ce corps. */
export function stripeSignature(rawBody: string, secret = WEBHOOK_SECRET, timestamp = Math.floor(Date.now() / 1000)): string {
  const v1 = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  return `t=${timestamp},v1=${v1}`;
}

/** Livre l'événement « checkout.session.completed » d'une session, signé comme le ferait Stripe. */
export function deliverWebhook(
  app: NestFastifyApplication,
  sessionId: string,
  options: { eventId?: string; type?: string; signature?: string } = {},
) {
  const rawBody = JSON.stringify({
    id: options.eventId ?? `evt_${randomBytes(12).toString('hex')}`,
    object: 'event',
    type: options.type ?? 'checkout.session.completed',
    data: { object: { id: sessionId, object: 'checkout.session' } },
  });
  return app.inject({
    method: 'POST',
    url: '/api/v1/payments/webhook',
    payload: rawBody,
    headers: { 'content-type': 'application/json', 'stripe-signature': options.signature ?? stripeSignature(rawBody) },
  });
}

export interface Purchase {
  reservationId: number;
  sessionId: string;
  commandeId: number;
  billetIds: number[];
}

/**
 * Achat complet par carte, comme un vrai client : réservation, ouverture du
 * paiement, paiement chez le prestataire, webhook signé, puis lecture de la commande.
 */
export async function buy(
  app: NestFastifyApplication,
  gateway: FakeGateway,
  client: Client,
  tarifId: number,
  quantite: number,
): Promise<Purchase> {
  const hold = await client.post('/orders/hold', { tarifId, quantite, modePaiement: 'carte' });
  if (hold.statusCode !== 201) throw new Error(`hold : ${hold.statusCode} ${hold.body}`);
  const reservationId: number = hold.json().id;
  return payHold(app, gateway, client, reservationId);
}

/** Paie une réservation existante (hold direct ou offre de liste d'attente). */
export async function payHold(
  app: NestFastifyApplication,
  gateway: FakeGateway,
  client: Client,
  reservationId: number,
): Promise<Purchase> {
  const checkout = await client.post(`/orders/holds/${reservationId}/checkout`);
  if (checkout.statusCode !== 200) throw new Error(`checkout : ${checkout.statusCode} ${checkout.body}`);
  const sessionId = sessionIdOf(checkout.json().url);
  gateway.pay(sessionId);
  const webhook = await deliverWebhook(app, sessionId);
  if (webhook.statusCode !== 200) throw new Error(`webhook : ${webhook.statusCode} ${webhook.body}`);
  const status = await client.get(`/orders/holds/${reservationId}`);
  const commandeId: number = status.json().commandeId;
  const order = await client.get(`/orders/${commandeId}`);
  return {
    reservationId,
    sessionId,
    commandeId,
    billetIds: (order.json().billets as { id: number }[]).map((b) => b.id),
  };
}

/** Connexion propriétaire, uniquement pour préparer et nettoyer les données de test. */
export const owner = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

export interface Response {
  statusCode: number;
  body: string;
  json: <T = any>() => T; // eslint-disable-line @typescript-eslint/no-explicit-any
  headers: Record<string, string | string[] | number | undefined>;
  cookies: { name: string; value: string; httpOnly?: boolean; sameSite?: string; secure?: boolean; maxAge?: number }[];
}

/** Client HTTP avec « bocal » à cookies et jeton CSRF, comme un navigateur. */
export class Client {
  private readonly jar = new Map<string, string>();
  csrf = '';

  constructor(private readonly app: NestFastifyApplication) {}

  static async anonymous(app: NestFastifyApplication): Promise<Client> {
    const client = new Client(app);
    const res = await client.get('/auth/csrf');
    client.csrf = res.json().csrfToken;
    return client;
  }

  static async login(app: NestFastifyApplication, email: string, password: string): Promise<Client> {
    const client = await Client.anonymous(app);
    const res = await client.post('/auth/login', { email, password });
    if (res.statusCode !== 200) throw new Error(`login ${email} : ${res.statusCode} ${res.body}`);
    client.csrf = res.json().csrfToken;
    return client;
  }

  get(url: string, headers: Record<string, string> = {}) {
    return this.request('GET', url, undefined, headers);
  }

  post(url: string, payload?: unknown, headers: Record<string, string> = {}) {
    return this.request('POST', url, payload, headers);
  }

  patch(url: string, payload?: unknown) {
    return this.request('PATCH', url, payload);
  }

  delete(url: string) {
    return this.request('DELETE', url);
  }

  async request(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS',
    url: string,
    payload?: unknown,
    headers: Record<string, string> = {},
  ): Promise<Response> {
    const cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await this.app.inject({
      method,
      url: `/api/v1${url}`,
      payload: payload as never,
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(method !== 'GET' && this.csrf ? { 'x-csrf-token': this.csrf } : {}),
        ...headers,
      },
    });
    for (const c of res.cookies as Response['cookies']) {
      if (c.value === '' || c.maxAge === 0) this.jar.delete(c.name);
      else this.jar.set(c.name, c.value);
      // Comme le front : le jeton CSRF courant est celui du cookie (rotation à la connexion).
      if (c.name === 'billetto_csrf' && c.value) this.csrf = c.value;
    }
    return res as unknown as Response;
  }

  setCookie(name: string, value: string): void {
    this.jar.set(name, value);
  }
}

export const argon2 = (password: string) =>
  hash(password, { algorithm: 2, memoryCost: 19_456, timeCost: 2, parallelism: 1 });
