import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false'])
  .default('true')
  .transform((value) => value === 'true');

const emptyAsUndefined = (value: unknown) => (value === '' ? undefined : value);

/** Valeurs publiques (anciens défauts du dépôt, exemples) : jamais acceptées comme secret. */
const PUBLIC_SECRET = /dev-only|^(replace|remplacer|change-?me|changeme|secret|password|example|billetto)/i;

export const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  // setup : application non initialisée, seul l'assistant de premier démarrage répond.
  // test / live : mode choisi dans l'assistant (Stripe de test ou réel).
  APP_MODE: z.enum(['setup', 'test', 'live']).default('test'),
  // Dossier de configuration inscriptible (assistant de premier démarrage, en conteneur).
  CONFIG_DIR: z.preprocess(emptyAsUndefined, z.string().max(200).optional()),
  // Fichier versionné des clés Stripe de test, proposées par l'assistant en mode test.
  STRIPE_TEST_KEYS_FILE: z.preprocess(emptyAsUndefined, z.string().max(200).optional()),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  // Compte restreint billetto_app : l'API ne se connecte jamais en propriétaire.
  APP_DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, 'URL PostgreSQL attendue'),
  // Compte MongoDB restreint (readWrite sur la base applicative). Aucune valeur par défaut.
  APP_MONGO_URL: z.string().regex(/^mongodb(\+srv)?:\/\//, 'URL MongoDB attendue'),
  JWT_SECRET: z
    .string()
    .min(32, 'au moins 32 caractères')
    .refine((value) => !PUBLIC_SECRET.test(value), 'valeur publique ou par défaut : générer un secret aléatoire'),
  // Clé Stripe : de test en mode test, réelle en mode live (contrôle croisé plus bas).
  // Facultative en mode test : sans elle, le paiement par carte répond 503.
  STRIPE_SECRET_KEY: z.preprocess(
    emptyAsUndefined,
    z
      .string()
      .regex(/^(sk|rk)_(test|live)_[A-Za-z0-9]{16,}$/, 'clé Stripe attendue (sk_… ou rk_…)')
      .optional(),
  ),
  STRIPE_WEBHOOK_SECRET: z.preprocess(
    emptyAsUndefined,
    z
      .string()
      .regex(/^whsec_[A-Za-z0-9+/=_-]{24,}$/, 'secret de webhook Stripe attendu (whsec_…)')
      .optional(),
  ),
  SESSION_TTL_SECONDS: z.coerce.number().int().min(60).max(86_400).default(7_200),
  CORS_ORIGIN: z.url(),
  COOKIE_SECURE: booleanString,
  // Nombre de proxys de confiance devant l'API (0 = aucun, l'adresse TCP fait foi).
  TRUST_PROXY: z.coerce.number().int().min(0).max(3).default(0),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  RATE_LIMIT_AUTH_MAX: z.coerce.number().int().positive().default(10),
  // Actions sensibles (réservation, liste d'attente, journal d'activité, paiement).
  RATE_LIMIT_SENSITIVE_MAX: z.coerce.number().int().positive().default(30),
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
  }
  // Le type de clé doit correspondre au mode : jamais de clé réelle en mode test,
  // jamais de clé de test en mode live.
  const { APP_MODE: mode, STRIPE_SECRET_KEY: key, STRIPE_WEBHOOK_SECRET: webhookSecret } = result.data;
  if (mode === 'test' && key && !/^(sk|rk)_test_/.test(key)) {
    throw new Error('STRIPE_SECRET_KEY : une clé de test (sk_test_… ou rk_test_…) est attendue en mode test');
  }
  if (mode === 'live') {
    if (!key || !webhookSecret) throw new Error('STRIPE_SECRET_KEY et STRIPE_WEBHOOK_SECRET sont requis en mode live');
    if (!/^(sk|rk)_live_/.test(key)) {
      throw new Error('STRIPE_SECRET_KEY : une clé réelle (sk_live_… ou rk_live_…) est attendue en mode live');
    }
  }
  return result.data;
}
