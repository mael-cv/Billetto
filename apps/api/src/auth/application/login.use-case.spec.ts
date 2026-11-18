import type { ApiError } from '../../common/errors/http-errors';
import type { CredentialsRepository, StoredCredentials } from '../domain/credentials.repository';
import type { PasswordHasher } from '../domain/password-hasher';
import { LoginUseCase } from './login.use-case';

const stored: StoredCredentials = {
  userId: 5,
  authVersion: 0,
  passwordHash: 'hash-correct',
  role: 'organizer',
  organisateurId: 3,
  prenom: 'Hugo',
  nom: 'Test',
  locked: false,
};

function setup(found: StoredCredentials | null) {
  const repo: CredentialsRepository = {
    findByEmail: jest.fn().mockResolvedValue(found),
    create: jest.fn(),
    changePassword: jest.fn(),
    sessionVersion: jest.fn().mockResolvedValue(found?.authVersion ?? null),
    recordFailedLogin: jest.fn().mockResolvedValue(undefined),
    resetFailedLogins: jest.fn().mockResolvedValue(undefined),
    revokeSessions: jest.fn(),
  };
  const hasher: PasswordHasher = {
    hash: jest.fn(),
    verify: jest.fn(async (hash: string, password: string) => hash === 'hash-correct' && password === 'secret'),
  };
  return { useCase: new LoginUseCase(repo, hasher), repo, hasher };
}

const errorOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return (e as ApiError).getResponse();
  }
  return undefined;
};

const GENERIC = { error: 'NON_AUTHENTIFIE', message: 'Identifiants invalides' };

describe('LoginUseCase', () => {
  it('renvoie l’acteur, normalise l’e-mail et remet le compteur d’échecs à zéro', async () => {
    const { useCase, repo } = setup(stored);
    const actor = await useCase.execute('  Hugo@Billetto.TEST ', 'secret');
    expect(repo.findByEmail).toHaveBeenCalledWith('hugo@billetto.test');
    expect(actor).toEqual({ userId: 5, authVersion: 0, role: 'organizer', organisateurId: 3, email: 'hugo@billetto.test', prenom: 'Hugo', nom: 'Test' });
    expect(repo.resetFailedLogins).toHaveBeenCalledWith(5);
    expect(repo.recordFailedLogin).not.toHaveBeenCalled();
  });

  it('mauvais mot de passe → 401 générique et échec compté', async () => {
    const { useCase, repo } = setup(stored);
    expect(await errorOf(useCase.execute('hugo@billetto.test', 'faux'))).toEqual(GENERIC);
    expect(repo.recordFailedLogin).toHaveBeenCalledWith('hugo@billetto.test');
    expect(repo.resetFailedLogins).not.toHaveBeenCalled();
  });

  it('compte inconnu → même réponse, et un hash est tout de même vérifié (temps constant)', async () => {
    const { useCase, hasher, repo } = setup(null);
    expect(await errorOf(useCase.execute('inconnu@billetto.test', 'secret'))).toEqual(GENERIC);
    expect(hasher.verify).toHaveBeenCalledTimes(1);
    expect((hasher.verify as jest.Mock).mock.calls[0][0]).toMatch(/^\$argon2id\$/);
    expect(repo.recordFailedLogin).not.toHaveBeenCalled();
  });

  it('compte verrouillé → même réponse, même avec le bon mot de passe, sans prolonger le verrou', async () => {
    const { useCase, hasher, repo } = setup({ ...stored, locked: true });
    expect(await errorOf(useCase.execute('hugo@billetto.test', 'secret'))).toEqual(GENERIC);
    expect(hasher.verify).toHaveBeenCalledTimes(1);
    expect(repo.recordFailedLogin).not.toHaveBeenCalled();
    expect(repo.resetFailedLogins).not.toHaveBeenCalled();
  });
});
