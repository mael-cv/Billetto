import type { Tx } from '../../../common/database/db-context.service';
import type { Pagination } from '../../../common/validation/schemas';
import type { OrderTicket } from '../../orders/domain/order';

export interface PurchaseResult {
  commandeId: number;
  paiementId: number;
  billetIds: number[];
  montantTotal: string;
}

export interface MyTicket extends OrderTicket {
  commandeId: number;
  statutCommande: 'pending' | 'paid' | 'cancelled' | 'refunded';
}

export interface TicketsRepository {
  /** Appelle acheter_billet() : toutes les règles métier et la concurrence sont gérées par PostgreSQL. */
  purchase(tx: Tx, userId: number, tarifId: number, quantite: number): Promise<PurchaseResult>;
  listForUser(tx: Tx, userId: number, pagination: Pagination): Promise<{ items: MyTicket[]; total: number }>;
}

export const TICKETS_REPOSITORY = Symbol('TICKETS_REPOSITORY');
