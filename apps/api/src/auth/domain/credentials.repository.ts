import type { AppRole } from '../../common/database/db-context.service';

export interface StoredCredentials {
  userId: number;
  passwordHash: string;
  role: AppRole;
  organisateurId: number | null;
  prenom: string;
  nom: string;
}

export interface NewAccount {
  email: string;
  passwordHash: string;
  prenom: string;
  nom: string;
}

export interface CredentialsRepository {
  findByEmail(email: string): Promise<StoredCredentials | null>;
  /** Crée un compte visitor. Lève une erreur 23505 si l'e-mail existe. */
  create(account: NewAccount): Promise<number>;
}

export const CREDENTIALS_REPOSITORY = Symbol('CREDENTIALS_REPOSITORY');
