import type { AppRole } from '../../common/database/db-context.service';

export interface StoredCredentials {
  userId: number;
  passwordHash: string;
  role: AppRole;
  organisateurId: number | null;
  prenom: string;
  nom: string;
  authVersion: number;
  /** Compte temporairement verrouillé après des échecs de connexion répétés. */
  locked: boolean;
}

export interface NewAccount {
  email: string;
  passwordHash: string;
  prenom: string;
  nom: string;
}

export interface CredentialsRepository {
  findByEmail(email: string): Promise<StoredCredentials | null>;
  /** Crée un compte visitor. Renvoie false si l'e-mail est déjà utilisé. */
  create(account: NewAccount): Promise<boolean>;
  changePassword(userId: number, passwordHash: string): Promise<void>;
  sessionVersion(userId: number): Promise<number | null>;
  /** Compte un échec ; au 10e consécutif, le compte est verrouillé 5 minutes. */
  recordFailedLogin(email: string): Promise<void>;
  resetFailedLogins(userId: number): Promise<void>;
  /** Invalide tous les jetons de session du compte (déconnexion). */
  revokeSessions(userId: number): Promise<void>;
}

export const CREDENTIALS_REPOSITORY = Symbol('CREDENTIALS_REPOSITORY');
