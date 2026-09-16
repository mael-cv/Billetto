import type { AppRole } from '../../common/database/db-context.service';

/** Utilisateur authentifié, tel que porté par la session. */
export interface Actor {
  userId: number;
  role: AppRole;
  organisateurId: number | null;
  email: string;
  prenom: string;
  nom: string;
}

export const APP_ROLES: readonly AppRole[] = ['visitor', 'organizer', 'admin'];
