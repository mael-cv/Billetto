import { randomUUID } from 'node:crypto';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyRequest } from 'fastify';
import { AppModule } from './app.module';
import { CSRF_HEADER } from './auth/presentation/cookies';
import type { AppConfig } from './common/config/config';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter';

type Bucket = 'auth' | 'sensitive' | 'api';

/**
 * Compteurs stricts, indexés par la route RÉSOLUE par le routeur (méthode + motif),
 * jamais par l'URL brute : un chemin encodé (/auth/%6cogin) vise le même compteur.
 */
const STRICT_ROUTES: Record<string, Bucket> = {
  'POST /api/v1/auth/login': 'auth',
  'POST /api/v1/auth/register': 'auth',
  'POST /api/v1/auth/password': 'auth',
  // Assistant de premier démarrage : mêmes limites que l'authentification (jeton à deviner).
  'POST /api/v1/setup': 'auth',
  'POST /api/v1/orders/hold': 'sensitive',
  'POST /api/v1/orders/holds/:id/checkout': 'sensitive',
  'POST /api/v1/waitlist': 'sensitive',
  'POST /api/v1/activites': 'sensitive',
};

function bucketOf(req: FastifyRequest): Bucket {
  return STRICT_ROUTES[`${req.method} ${req.routeOptions?.url ?? ''}`] ?? 'api';
}

/** Fonctionnalités navigateur inutiles à une API JSON (non géré par helmet). */
export const PERMISSIONS_POLICY = 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()';

/** Construit l'application (partagé entre main.ts et les tests e2e). */
export async function createApp(config: AppConfig): Promise<NestFastifyApplication> {
  const silent = config.LOG_LEVEL === 'silent';
  const adapter = new FastifyAdapter({
    // Limite de taille des corps de requête (déni de service, OWASP).
    bodyLimit: 64 * 1024,
    requestTimeout: 30_000,
    maxParamLength: 128,
    http: { maxHeaderSize: 16 * 1024 },
    // 0 : l'adresse TCP fait foi. N : seuls les N derniers sauts de X-Forwarded-For
    // (ceux ajoutés par nos proxys) sont crus ; ce que le client envoie est ignoré.
    trustProxy: config.TRUST_PROXY === 0 ? false : (_address: string, hop: number) => hop < config.TRUST_PROXY,
    // Un appelant ne peut pas choisir l'identifiant repris dans les logs/erreurs.
    requestIdHeader: false,
    genReqId: () => randomUUID(),
    logger: silent
      ? false
      : {
          level: config.LOG_LEVEL,
          // Jamais de secret dans les journaux (les corps ne sont pas journalisés).
          redact: {
            paths: [
              'req.headers.cookie',
              `req.headers["${CSRF_HEADER}"]`,
              'req.headers.authorization',
              'req.headers["x-billetto-signature"]',
              'res.headers["set-cookie"]',
            ],
            censor: '[masqué]',
          },
        },
  });

  const app = await NestFactory.create<NestFastifyApplication>(AppModule.forRoot(config), adapter, {
    logger: silent ? false : ['error', 'warn', 'log'],
    bufferLogs: false,
  });

  // Le webhook signe les octets JSON exacts, avant leur parsing.
  app.getHttpAdapter().registerParserMiddleware(undefined, true);

  await app.register(helmet, {
    // API JSON : aucune ressource à charger, aucun affichage en iframe.
    contentSecurityPolicy: { useDefaults: false, directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    frameguard: { action: 'deny' },
    crossOriginResourcePolicy: { policy: 'same-site' },
  });
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onRequest', (_req, reply, done) => {
      reply.header('permissions-policy', PERMISSIONS_POLICY);
      done();
    });
  await app.register(cookie);
  await app.register(rateLimit, {
    global: true,
    timeWindow: '1 minute',
    // Compteurs séparés et plus stricts : authentification (force brute) et
    // actions sensibles (blocage de stock, remplissage du journal).
    keyGenerator: (req: FastifyRequest) => `${req.ip}:${bucketOf(req)}`,
    max: (req: FastifyRequest) => {
      const bucket = bucketOf(req);
      if (bucket === 'auth') return config.RATE_LIMIT_AUTH_MAX;
      return bucket === 'sensitive' ? config.RATE_LIMIT_SENSITIVE_MAX : config.RATE_LIMIT_MAX;
    },
    errorResponseBuilder: (_req, context) => ({
      statusCode: 429,
      error: 'TROP_DE_REQUETES',
      message: `Trop de requêtes, réessayez dans ${Math.ceil(context.ttl / 1000)} s`,
    }),
  });

  app.enableCors({
    origin: [config.CORS_ORIGIN],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'X-CSRF-Token'],
    maxAge: 600,
  });
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();
  return app;
}
