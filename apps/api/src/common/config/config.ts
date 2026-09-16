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
  SESSION_TTL_SECONDS: z.coerce.number().int().min(60).max(86_400).default(7_200),
  CORS_ORIGIN: z.url(),
  COOKIE_SECURE: booleanString,
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  RATE_LIMIT_AUTH_MAX: z.coerce.number().int().positive().default(10),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'silent']).default('info'),
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
  return result.data;
}
