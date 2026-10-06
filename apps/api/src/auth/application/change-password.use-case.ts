import { Inject, Injectable } from '@nestjs/common';
import { unauthorized } from '../../common/errors/http-errors';
import type { Actor } from '../domain/actor';
import { CREDENTIALS_REPOSITORY, type CredentialsRepository } from '../domain/credentials.repository';
import { PASSWORD_HASHER, type PasswordHasher } from '../domain/password-hasher';

@Injectable()
export class ChangePasswordUseCase {
  constructor(
    @Inject(CREDENTIALS_REPOSITORY) private readonly credentials: CredentialsRepository,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
  ) {}

  async execute(actor: Actor, currentPassword: string, newPassword: string): Promise<void> {
    const stored = await this.credentials.findByEmail(actor.email);
    if (!stored || stored.userId !== actor.userId || !(await this.hasher.verify(stored.passwordHash, currentPassword))) {
      throw unauthorized('Mot de passe actuel invalide');
    }
    await this.credentials.changePassword(actor.userId, await this.hasher.hash(newPassword));
  }
}
