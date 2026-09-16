import type { AppRole, Tx } from '../../../common/database/db-context.service';
import type { Pagination } from '../../../common/validation/schemas';

export interface UserAdminView {
  id: number;
  email: string;
  prenom: string;
  nom: string;
  role: AppRole;
  organisateurId: number | null;
  createdAt: Date;
}

export interface UsersRepository {
  /** Rôle admin attendu (lecture de l'e-mail autorisée à l'admin seulement). */
  list(tx: Tx, q: string | undefined, pagination: Pagination): Promise<{ items: UserAdminView[]; total: number }>;
  /** Nombre de lignes modifiées. */
  changeRole(tx: Tx, id: number, role: AppRole, organisateurId: number | null): Promise<number>;
  findById(tx: Tx, id: number): Promise<UserAdminView | null>;
}

export const USERS_REPOSITORY = Symbol('USERS_REPOSITORY');
