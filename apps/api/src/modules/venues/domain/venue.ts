import type { Tx } from '../../../common/database/db-context.service';
import type { Pagination } from '../../../common/validation/schemas';

export interface Venue {
  id: number;
  nom: string;
  adresse: string;
  ville: string;
  codePostal: string;
  capacite: number;
}

export interface VenuesRepository {
  list(tx: Tx, ville: string | undefined, pagination: Pagination): Promise<{ items: Venue[]; total: number }>;
  cities(tx: Tx): Promise<string[]>;
}

export const VENUES_REPOSITORY = Symbol('VENUES_REPOSITORY');
