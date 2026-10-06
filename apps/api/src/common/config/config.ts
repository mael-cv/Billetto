import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false'])
  .default('true')
  .transform((value) => value === 'true');

export const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  // Compte restreint billetto_app : l'API ne se connecte jamais en propriétaire.
  APP_DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, 'URL PostgreSQL attendue'),
  JWT_SECRET: z.string().min(32, 'au moins 32 caractères'),
  // Facultatif en développement sans prestataire ; requis pour accepter un webhook.
  PAYMENTS_WEBHOOK_SECRET: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().min(32, 'au moins 32 caractères').optional(),
  ),
  SESSION_TTL_SECONDS: z.coerce.number().int().min(60).max(86_400).default(7_200),
  CORS_ORIGIN: z.url(),
  COOKIE_SECURE: booleanString,
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  RATE_LIMIT_AUTH_MAX: z.coerce.number().int().positive().default(10),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'silent']).default('info'),
  // E-mails (phase 15). Sans SMTP_URL, les e-mails restent dans l'outbox.
  SMTP_URL: z
    .string()
    .trim()
    .transform((v) => v || undefined)
    .pipe(z.string().regex(/^smtps?:\/\//, 'URL smtp:// ou smtps:// attendue').optional())
    .optional(),
  MAIL_FROM: z.string().trim().min(3).default('Billetto <billets@billetto.local>'),
  EMAIL_OUTBOX_INTERVAL_MS: z.coerce.number().int().min(0).default(10_000),
});

export type AppConfig = z.infer<typeof configSchema>;

export const APP_CONFIG = Symbol('APP_CONFIG');

/** Valide l'environnement au démarrage. Les valeurs ne sont jamais affichées (secrets). */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    const details = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Configuration invalide — ${details.join(' ; ')}`);
  }
  if (result.data.NODE_ENV === 'production') {
    if (!result.data.COOKIE_SECURE) throw new Error('COOKIE_SECURE doit être true en production');
    if (new URL(result.data.CORS_ORIGIN).protocol !== 'https:') {
      throw new Error('CORS_ORIGIN doit utiliser HTTPS en production');
    }
    if (/^(replace|remplacer|change-me|secret|password)/i.test(result.data.JWT_SECRET)) {
      throw new Error('JWT_SECRET doit être remplacé par un secret aléatoire en production');
    }
  }
  return result.data;
}
