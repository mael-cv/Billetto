import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AppConfig } from '../../common/config/config';
import type { ApiError } from '../../common/errors/http-errors';
import { SessionTokenService } from '../application/session-token.service';
import type { Actor } from '../domain/actor';
import { ROLES_KEY, SKIP_CSRF_KEY } from './auth.decorators';
import { AuthGuard } from './auth.guard';
import { CSRF_COOKIE, SESSION_COOKIE } from './cookies';
import { CsrfGuard } from './csrf.guard';

const handler = () => undefined;
const controllerClass = () => undefined;

function context(request: Record<string, unknown>, metadata: Record<string, unknown> = {}): ExecutionContext {
  for (const [key, value] of Object.entries(metadata)) Reflect.defineMetadata(key, value, handler);
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => handler,
    getClass: () => controllerClass,
  } as unknown as ExecutionContext;
}

afterEach(() => {
  for (const key of Reflect.getMetadataKeys(handler)) Reflect.deleteMetadata(key, handler);
});

const statusOf = (fn: () => unknown): number | undefined => {
  try {
    fn();
  } catch (e) {
    return (e as ApiError).getStatus();
  }
  return undefined;
};

describe('CsrfGuard', () => {
  const guard = new CsrfGuard(new Reflector());
  const token = 'a'.repeat(43);

  it('laisse passer les méthodes sûres', () => {
    expect(guard.canActivate(context({ method: 'GET', headers: {}, cookies: {} }))).toBe(true);
  });

  it('refuse une requête modifiante sans jeton', () => {
    expect(statusOf(() => guard.canActivate(context({ method: 'POST', headers: {}, cookies: {} })))).toBe(403);
  });

  it('refuse un en-tête différent du cookie', () => {
    const req = { method: 'POST', headers: { 'x-csrf-token': 'b'.repeat(43) }, cookies: { [CSRF_COOKIE]: token } };
    expect(statusOf(() => guard.canActivate(context(req)))).toBe(403);
  });

  it('refuse un jeton trop court', () => {
    const req = { method: 'DELETE', headers: { 'x-csrf-token': 'abc' }, cookies: { [CSRF_COOKIE]: 'abc' } };
    expect(statusOf(() => guard.canActivate(context(req)))).toBe(403);
  });

  it('accepte un en-tête identique au cookie', () => {
    const req = { method: 'PATCH', headers: { 'x-csrf-token': token }, cookies: { [CSRF_COOKIE]: token } };
    expect(guard.canActivate(context(req))).toBe(true);
  });

  it('respecte @SkipCsrf', () => {
    expect(guard.canActivate(context({ method: 'POST', headers: {}, cookies: {} }, { [SKIP_CSRF_KEY]: true }))).toBe(true);
  });
});

describe('AuthGuard', () => {
  const tokens = new SessionTokenService({ JWT_SECRET: 's'.repeat(40), SESSION_TTL_SECONDS: 600 } as AppConfig);
  const guard = new AuthGuard(new Reflector(), tokens);
  const visitor: Actor = { userId: 1, role: 'visitor', organisateurId: null, email: 'v@t', prenom: 'V', nom: 'V' };
  const withSession = (actor: Actor) => ({ cookies: { [SESSION_COOKIE]: tokens.sign(actor) } });

  it('route publique : identifie sans exiger de session', () => {
    const req: Record<string, unknown> = { cookies: {} };
    expect(guard.canActivate(context(req))).toBe(true);
    expect(req.actor).toBeNull();
  });

  it('route protégée sans session → 401', () => {
    expect(statusOf(() => guard.canActivate(context({ cookies: {} }, { [ROLES_KEY]: [] })))).toBe(401);
  });

  it('rôle insuffisant → 403', () => {
    expect(statusOf(() => guard.canActivate(context(withSession(visitor), { [ROLES_KEY]: ['organizer', 'admin'] })))).toBe(403);
  });

  it('rôle autorisé → accès et acteur exposé', () => {
    const req: Record<string, unknown> = withSession({ ...visitor, role: 'admin' });
    expect(guard.canActivate(context(req, { [ROLES_KEY]: ['admin'] }))).toBe(true);
    expect((req.actor as Actor).role).toBe('admin');
  });

  it('cookie falsifié → anonyme', () => {
    const req: Record<string, unknown> = { cookies: { [SESSION_COOKIE]: 'faux.jeton.signature' } };
    guard.canActivate(context(req));
    expect(req.actor).toBeNull();
  });
});
