import { Inject, Injectable } from '@nestjs/common';
import type { Actor } from '../domain/actor';
import { CREDENTIALS_REPOSITORY, type CredentialsRepository } from '../domain/credentials.repository';
import { PASSWORD_HASHER, type PasswordHasher } from '../domain/password-hasher';

export interface RegisterCommand {
  email: string;
  password: string;
  prenom: string;
  nom: string;
}

@Injectable()
export class RegisterUseCase {
  constructor(
    @Inject(CREDENTIALS_REPOSITORY) private readonly credentials: CredentialsRepository,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
  ) {}

  /** Crée un compte visitor (le rôle n'est jamais choisi par le client). */
  async execute(command: RegisterCommand): Promise<Actor> {
    const email = command.email.trim().toLowerCase();
    const passwordHash = await this.hasher.hash(command.password);
    const userId = await this.credentials.create({
      email,
      passwordHash,
      prenom: command.prenom,
      nom: command.nom,
    });
    return { userId, role: 'visitor', organisateurId: null, email, prenom: command.prenom, nom: command.nom };
  }
}
