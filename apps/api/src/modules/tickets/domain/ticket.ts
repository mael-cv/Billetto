import type { Tx } from '../../../common/database/db-context.service';
import type { TicketTemplateDocument } from '../../../common/mongodb/templates.types';
import type { Pagination } from '../../../common/validation/schemas';
import type { OrderTicket } from '../../orders/domain/order';

export interface PurchaseResult {
  commandeId: number;
  paiementId: number;
  billetIds: number[];
  montantTotal: string;
  evenementId: number;
}

export interface MyTicket extends OrderTicket {
  commandeId: number;
  statutCommande: 'pending' | 'paid' | 'cancelled' | 'refunded';
  /** Contenu du QR de check-in : BT1.<code>.<signature HMAC> (vérifié par scanner_billet). */
  qrPayload: string;
  /** Annulation self-service possible jusqu'à cette date (délai configurable par événement). */
  annulationPossibleJusqua: Date | null;
  /** Template visuel NoSQL (MongoDB) */
  template?: TicketTemplateDocument;
}

export interface TicketsRepository {
  /** Appelle acheter_billet() : toutes les règles métier et la concurrence sont gérées par PostgreSQL. */
  purchase(tx: Tx, userId: number, tarifId: number, quantite: number): Promise<PurchaseResult>;
  listForUser(tx: Tx, userId: number, pagination: Pagination): Promise<{ items: MyTicket[]; total: number }>;
}

export const TICKETS_REPOSITORY = Symbol('TICKETS_REPOSITORY');
