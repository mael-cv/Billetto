import type { Tx } from '../../../common/database/db-context.service';

export type WaitlistStatus = 'en_attente' | 'notifiee' | 'confirmee' | 'expiree' | 'annulee';

/** Vue organisateur : aucune donnée personnelle de l'inscrit. */
export interface WaitlistQueueItem {
  id: number;
  quantite: number;
  statut: WaitlistStatus;
  /** Rang FIFO (1 = tête) tant que l'inscription est en_attente, null sinon. */
  position: number | null;
  notifieA: Date | null;
  expireA: Date | null;
  createdAt: Date;
}

export interface WaitlistEntry extends WaitlistQueueItem {
  tarifId: number;
  tarif: string;
  evenementId: number;
  evenement: string;
  /** Réservation de l'offre en cours (statut notifiee) : à payer via /orders/holds/:id/checkout. */
  reservationId: number | null;
}

export interface WaitlistRepository {
  /** Rôle visiteur + app.user_id = userId attendus. */
  join(tx: Tx, userId: number, tarifId: number, quantite: number): Promise<number>;
  listForUser(tx: Tx, userId: number): Promise<WaitlistEntry[]>;
  findForUser(tx: Tx, userId: number, entryId: number): Promise<WaitlistEntry | null>;
  cancel(tx: Tx, userId: number, entryId: number): Promise<void>;
  /** Rôle organisateur (RLS : ses tarifs) ou admin. */
  queueForTarif(tx: Tx, tarifId: number): Promise<WaitlistQueueItem[]>;
}

export const WAITLIST_REPOSITORY = Symbol('WAITLIST_REPOSITORY');
