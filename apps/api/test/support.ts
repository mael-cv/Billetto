import { resolve } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { hash } from '@node-rs/argon2';
import { PrismaClient } from '@prisma/client';
import { createApp } from '../src/app.factory';
import { type AppConfig, loadConfig } from '../src/common/config/config';

try {
  process.loadEnvFile(resolve(__dirname, '../../../.env'));
} catch {
  // variables déjà présentes (CI)
}

export const RUN = `${Date.now()}`;
export const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? 'Billetto-Demo-2026!';
export const TEST_PASSWORD = 'Mot-de-passe-e2e-2026!';

export function testConfig(overrides: Partial<Record<keyof AppConfig, string>> = {}): AppConfig {
  return loadConfig({
    ...process.env,
    LOG_LEVEL: 'silent',
    RATE_LIMIT_MAX: '100000',
    RATE_LIMIT_AUTH_MAX: '100000',
    ...overrides,
  });
}

export async function startApp(config = testConfig()): Promise<NestFastifyApplication> {
  const app = await createApp(config);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
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
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'OPTIONS',
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
