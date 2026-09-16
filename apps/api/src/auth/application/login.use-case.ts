import { Inject, Injectable } from '@nestjs/common';
import { unauthorized } from '../../common/errors/http-errors';
import type { Actor } from '../domain/actor';
import { CREDENTIALS_REPOSITORY, type CredentialsRepository } from '../domain/credentials.repository';
import { PASSWORD_HASHER, type PasswordHasher } from '../domain/password-hasher';

// Hash Argon2id valide d'un mot de passe aléatoire jamais utilisé : vérifié quand
// l'e-mail est inconnu pour que le temps de réponse ne révèle pas l'existence du compte.
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$j8ICDezZ6Jm1F1SF3eB9wg$Z90ok0hYn8tW7P9IhNrLDK5ayN313nP2a3TdccgsW5o';

@Injectable()
export class LoginUseCase {
  constructor(
    @Inject(CREDENTIALS_REPOSITORY) private readonly credentials: CredentialsRepository,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
  ) {}

  async execute(email: string, password: string): Promise<Actor> {
    const normalizedEmail = email.trim().toLowerCase();
    const stored = await this.credentials.findByEmail(normalizedEmail);
    const valid = await this.hasher.verify(stored?.passwordHash ?? DUMMY_HASH, password);

    // Même réponse pour « compte inconnu » et « mauvais mot de passe ».
    if (!stored || !valid) throw unauthorized('Identifiants invalides');

    return {
      userId: stored.userId,
      role: stored.role,
      organisateurId: stored.organisateurId,
      email: normalizedEmail,
      prenom: stored.prenom,
      nom: stored.nom,
    };
  }
}
