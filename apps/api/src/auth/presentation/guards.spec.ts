import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AppConfig } from '../../common/config/config';
import type { ApiError } from '../../common/errors/http-errors';
import { SessionTokenService } from '../application/session-token.service';
import type { Actor } from '../domain/actor';
import { OPTIONAL_AUTH_KEY, PUBLIC_ACCESS_KEY, ROLES_KEY, SKIP_CSRF_KEY } from './auth.decorators';
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

const statusOf = async (fn: () => boolean | Promise<boolean>): Promise<number | undefined> => {
  try {
    await fn();
  } catch (e) {
    return (e as ApiError).getStatus();
  }
  return undefined;
};

describe('CsrfGuard', () => {
  const guard = new CsrfGuard(new Reflector(), { CORS_ORIGIN: 'http://localhost:5173' } as AppConfig);
  const token = 'a'.repeat(43);

  it('allows safe methods', () => {
    expect(guard.canActivate(context({ method: 'GET', headers: {}, cookies: {} }))).toBe(true);
  });

  it('rejects missing or mismatched tokens', async () => {
    expect(await statusOf(() => guard.canActivate(context({ method: 'POST', headers: {}, cookies: {} })))).toBe(403);
    expect(await statusOf(() => guard.canActivate(context({ method: 'POST', headers: { 'x-csrf-token': 'b'.repeat(43) }, cookies: { [CSRF_COOKIE]: token } })))).toBe(403);
  });

  it('accepts matching tokens and honors SkipCsrf', () => {
    expect(guard.canActivate(context({ method: 'PATCH', headers: { 'x-csrf-token': token }, cookies: { [CSRF_COOKIE]: token } }))).toBe(true);
    expect(guard.canActivate(context({ method: 'POST', headers: {}, cookies: {} }, { [SKIP_CSRF_KEY]: true }))).toBe(true);
  });
});

describe('AuthGuard', () => {
  const tokens = new SessionTokenService({ JWT_SECRET: 's'.repeat(40), SESSION_TTL_SECONDS: 600 } as AppConfig);
  const credentials = { sessionVersion: jest.fn().mockResolvedValue(0) };
  const guard = new AuthGuard(new Reflector(), tokens, credentials as never);
  const visitor: Actor = { userId: 1, authVersion: 0, role: 'visitor', organisateurId: null, email: 'v@t', prenom: 'V', nom: 'V' };
  const withSession = (actor: Actor) => ({ cookies: { [SESSION_COOKIE]: tokens.sign(actor) } });

  it('requires explicit access metadata and permits an explicitly optional route', async () => {
    const req: Record<string, unknown> = { cookies: {} };
    expect(await statusOf(() => guard.canActivate(context(req)))).toBe(401);
    await expect(guard.canActivate(context(req, { [OPTIONAL_AUTH_KEY]: true }))).resolves.toBe(true);
    expect(req.actor).toBeNull();
  });

  it('permits a route explicitly marked public', async () => {
    await expect(guard.canActivate(context({ cookies: {} }, { [PUBLIC_ACCESS_KEY]: true }))).resolves.toBe(true);
  });

  it('rejects a missing session or insufficient role', async () => {
    expect(await statusOf(() => guard.canActivate(context({ cookies: {} }, { [ROLES_KEY]: [] })))).toBe(401);
    expect(await statusOf(() => guard.canActivate(context(withSession(visitor), { [ROLES_KEY]: ['organizer', 'admin'] })))).toBe(403);
  });

  it('accepts a valid role and rejects a revoked session', async () => {
    const req: Record<string, unknown> = withSession({ ...visitor, role: 'admin' });
    await expect(guard.canActivate(context(req, { [ROLES_KEY]: ['admin'] }))).resolves.toBe(true);
    expect((req.actor as Actor).role).toBe('admin');

    credentials.sessionVersion.mockResolvedValueOnce(1);
    expect(await statusOf(() => guard.canActivate(context(withSession(visitor), { [ROLES_KEY]: [] })))).toBe(401);
  });

  it('treats a forged cookie as anonymous', async () => {
    const req: Record<string, unknown> = { cookies: { [SESSION_COOKIE]: 'fake.token.signature' } };
    await expect(statusOf(() => guard.canActivate(context(req, { [OPTIONAL_AUTH_KEY]: true })))).resolves.toBeUndefined();
    expect(req.actor).toBeNull();
  });
});
