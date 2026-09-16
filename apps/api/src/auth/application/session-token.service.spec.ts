import { createHmac } from 'node:crypto';
import type { AppConfig } from '../../common/config/config';
import type { Actor } from '../domain/actor';
import { SessionTokenService } from './session-token.service';

const config = { JWT_SECRET: 'x'.repeat(48), SESSION_TTL_SECONDS: 3600 } as AppConfig;
const actor: Actor = {
  userId: 42,
  role: 'organizer',
  organisateurId: 7,
  email: 'a@b.test',
  prenom: 'A',
  nom: 'B',
};

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

describe('SessionTokenService', () => {
  const service = new SessionTokenService(config);
  const now = Date.UTC(2026, 8, 16, 12);

  it('signe puis vérifie un jeton', () => {
    expect(service.verify(service.sign(actor, now), now)).toEqual(actor);
  });

  it('refuse un jeton expiré', () => {
    const token = service.sign(actor, now);
    expect(service.verify(token, now + 3601 * 1000)).toBeNull();
  });

  it('refuse un payload modifié (élévation de rôle)', () => {
    const [h, , s] = service.sign(actor, now).split('.');
    const forged = b64({ sub: 42, role: 'admin', org: null, email: 'a@b.test', prenom: 'A', nom: 'B', iat: 0, exp: 9e9 });
    expect(service.verify(`${h}.${forged}.${s}`, now)).toBeNull();
  });

  it('refuse l’algorithme « none »', () => {
    const payload = service.sign(actor, now).split('.')[1];
    expect(service.verify(`${b64({ alg: 'none', typ: 'JWT' })}.${payload}.`, now)).toBeNull();
  });

  it('refuse un jeton signé avec un autre secret', () => {
    const other = new SessionTokenService({ ...config, JWT_SECRET: 'y'.repeat(48) });
    expect(service.verify(other.sign(actor, now), now)).toBeNull();
  });

  it('refuse un payload valide cryptographiquement mais mal formé', () => {
    const header = b64({ alg: 'HS256', typ: 'JWT' });
    const payload = b64({ sub: 'not-a-number', role: 'root', exp: 9e9 });
    const sig = createHmac('sha256', config.JWT_SECRET).update(`${header}.${payload}`).digest('base64url');
    expect(service.verify(`${header}.${payload}.${sig}`, now)).toBeNull();
  });

  it.each([undefined, '', 'a.b', 'x'.repeat(5000)])('refuse une entrée invalide (%p)', (token) => {
    expect(service.verify(token, now)).toBeNull();
  });
});
