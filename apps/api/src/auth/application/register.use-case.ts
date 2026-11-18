import { Inject, Injectable } from '@nestjs/common';
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

  /**
   * Crée un compte visitor (le rôle n'est jamais choisi par le client).
   * Ne renvoie rien : que l'adresse soit libre ou déjà utilisée, l'appelant
   * obtient la même réponse et aucune session, sinon l'inscription permettrait
   * de savoir quelles adresses ont un compte. Le hash est calculé dans les deux
   * cas (même temps de réponse).
   */
  async execute(command: RegisterCommand): Promise<void> {
    const email = command.email.trim().toLowerCase();
    const passwordHash = await this.hasher.hash(command.password);
    await this.credentials.create({ email, passwordHash, prenom: command.prenom, nom: command.nom });
  }
}
