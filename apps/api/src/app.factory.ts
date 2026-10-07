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

const AUTH_ROUTES = /^\/api\/v1\/auth\/(login|register|password)$/;

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
    trustProxy: false,
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
    // Compteur séparé et plus strict pour login / register (force brute).
    keyGenerator: (req: FastifyRequest) => `${req.ip}:${AUTH_ROUTES.test(req.url.split('?')[0] ?? '') ? 'auth' : 'api'}`,
    max: (req: FastifyRequest) =>
      AUTH_ROUTES.test(req.url.split('?')[0] ?? '') ? config.RATE_LIMIT_AUTH_MAX : config.RATE_LIMIT_MAX,
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
