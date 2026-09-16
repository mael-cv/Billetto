import type { Tx } from '../../../common/database/db-context.service';
import type { Pagination } from '../../../common/validation/schemas';

export type OrderStatus = 'pending' | 'paid' | 'cancelled' | 'refunded';

export interface OrderSummary {
  id: number;
  statut: OrderStatus;
  montantTotal: string;
  createdAt: Date;
  nbBillets: number;
}

export interface OrderTicket {
  id: number;
  code: string;
  evenementId: number;
  evenement: string;
  debut: Date;
  lieu: string;
  ville: string;
  tarif: string;
  prixPaye: string;
}

export interface OrderDetail extends OrderSummary {
  utilisateurId: number;
  billets: OrderTicket[];
}

export interface OrdersRepository {
  /** Rôle visiteur + app.user_id = userId attendus. */
  listForBuyer(tx: Tx, userId: number, pagination: Pagination): Promise<{ items: OrderSummary[]; total: number }>;
  findForBuyer(tx: Tx, userId: number, orderId: number): Promise<OrderDetail | null>;
  /** Rôle admin attendu. */
  findAny(tx: Tx, orderId: number): Promise<OrderDetail | null>;
  refundAsOwner(tx: Tx, orderId: number): Promise<void>;
  refundAsAdmin(tx: Tx, orderId: number): Promise<void>;
}

export const ORDERS_REPOSITORY = Symbol('ORDERS_REPOSITORY');
