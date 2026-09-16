import type { ApiError } from '../../common/errors/http-errors';
import type { CredentialsRepository, StoredCredentials } from '../domain/credentials.repository';
import type { PasswordHasher } from '../domain/password-hasher';
import { LoginUseCase } from './login.use-case';

const stored: StoredCredentials = {
  userId: 5,
  passwordHash: 'hash-correct',
  role: 'organizer',
  organisateurId: 3,
  prenom: 'Hugo',
  nom: 'Test',
};

function setup(found: StoredCredentials | null) {
  const repo: CredentialsRepository = {
    findByEmail: jest.fn().mockResolvedValue(found),
    create: jest.fn(),
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

describe('LoginUseCase', () => {
  it('renvoie l’acteur et normalise l’e-mail', async () => {
    const { useCase, repo } = setup(stored);
    const actor = await useCase.execute('  Hugo@Billetto.TEST ', 'secret');
    expect(repo.findByEmail).toHaveBeenCalledWith('hugo@billetto.test');
    expect(actor).toEqual({ userId: 5, role: 'organizer', organisateurId: 3, email: 'hugo@billetto.test', prenom: 'Hugo', nom: 'Test' });
  });

  it('mauvais mot de passe → 401 générique', async () => {
    const { useCase } = setup(stored);
    expect(await errorOf(useCase.execute('hugo@billetto.test', 'faux'))).toEqual({
      error: 'NON_AUTHENTIFIE',
      message: 'Identifiants invalides',
    });
  });

  it('compte inconnu → même réponse, et un hash est tout de même vérifié (temps constant)', async () => {
    const { useCase, hasher } = setup(null);
    expect(await errorOf(useCase.execute('inconnu@billetto.test', 'secret'))).toEqual({
      error: 'NON_AUTHENTIFIE',
      message: 'Identifiants invalides',
    });
    expect(hasher.verify).toHaveBeenCalledTimes(1);
    expect((hasher.verify as jest.Mock).mock.calls[0][0]).toMatch(/^\$argon2id\$/);
  });
});
