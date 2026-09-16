import type { Tx } from '../../../common/database/db-context.service';

export interface Payment {
  id: number;
  reference: string;
  type: 'charge' | 'refund';
  montant: string;
  statut: 'pending' | 'succeeded' | 'failed';
  createdAt: Date;
}

export interface PaymentsRepository {
  /** null si la commande n'est pas visible pour l'appelant. */
  listForOrder(tx: Tx, orderId: number, ownerId: number | null): Promise<Payment[] | null>;
}

export const PAYMENTS_REPOSITORY = Symbol('PAYMENTS_REPOSITORY');
