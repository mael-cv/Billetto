import { randomBytes } from 'node:crypto';
import type { CookieSerializeOptions } from '@fastify/cookie';
import type { FastifyReply } from 'fastify';
import type { AppConfig } from '../../common/config/config';

export const SESSION_COOKIE = 'billetto_session';
export const CSRF_COOKIE = 'billetto_csrf';
export const CSRF_HEADER = 'x-csrf-token';

const base = (config: AppConfig): CookieSerializeOptions => ({
  path: '/',
  sameSite: 'strict',
  secure: config.COOKIE_SECURE,
});

export function setSessionCookie(reply: FastifyReply, token: string, config: AppConfig): void {
  // HttpOnly : inaccessible au JavaScript de la page (vol par XSS).
  void reply.setCookie(SESSION_COOKIE, token, {
    ...base(config),
    httpOnly: true,
    maxAge: config.SESSION_TTL_SECONDS,
  });
}

export function clearSessionCookie(reply: FastifyReply, config: AppConfig): void {
  void reply.clearCookie(SESSION_COOKIE, { ...base(config), httpOnly: true });
}

/**
 * CSRF « double submit » : le jeton est posé dans un cookie lisible par le front
 * (même origine) et doit être renvoyé dans l'en-tête X-CSRF-Token. Un site tiers
 * ne peut ni lire le cookie ni poser l'en-tête.
 */
export function issueCsrfToken(reply: FastifyReply, config: AppConfig): string {
  const token = randomBytes(32).toString('base64url');
  void reply.setCookie(CSRF_COOKIE, token, { ...base(config), httpOnly: false, maxAge: config.SESSION_TTL_SECONDS });
  return token;
}
