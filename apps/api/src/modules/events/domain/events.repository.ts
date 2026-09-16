import type { Tx } from '../../../common/database/db-context.service';
import type { Pagination } from '../../../common/validation/schemas';
import type { EventDetail, EventFilters, EventInput, EventSummary } from './event';

/**
 * Toutes les méthodes reçoivent une transaction dont le rôle PostgreSQL et
 * app.user_id sont déjà positionnés : la RLS décide des lignes visibles.
 */
export interface EventsRepository {
  list(tx: Tx, filters: EventFilters, pagination: Pagination): Promise<{ items: EventSummary[]; total: number }>;
  findByRef(tx: Tx, ref: { id: number } | { slug: string }): Promise<EventDetail | null>;
  create(tx: Tx, organisateurId: number, input: EventInput): Promise<number>;
  /** Nombre de lignes modifiées (0 si l'événement est invisible pour l'appelant). */
  update(tx: Tx, id: number, input: Partial<EventInput>): Promise<number>;
  delete(tx: Tx, id: number): Promise<number>;
}

export const EVENTS_REPOSITORY = Symbol('EVENTS_REPOSITORY');
