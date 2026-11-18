import { Inject, Injectable } from '@nestjs/common';
import type { Actor } from '../domain/actor';
import { CREDENTIALS_REPOSITORY, type CredentialsRepository } from '../domain/credentials.repository';

@Injectable()
export class LogoutUseCase {
  constructor(@Inject(CREDENTIALS_REPOSITORY) private readonly credentials: CredentialsRepository) {}

  /** Incrémente la version de session : un jeton copié avant la déconnexion ne vaut plus rien. */
  execute(actor: Actor): Promise<void> {
    return this.credentials.revokeSessions(actor.userId);
  }
}
