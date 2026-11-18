import type { Tx } from '../../../common/database/db-context.service';
import type { Pagination } from '../../../common/validation/schemas';

export type OrderStatus = 'pending' | 'en_attente_virement' | 'paid' | 'cancelled' | 'refunded';

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
  /** Annulation self-service possible jusqu'à cette date (null : vue admin ou commande sans billet). */
  annulationPossibleJusqua: Date | null;
}

export type ReservationStatus = 'active' | 'confirmee' | 'expiree' | 'annulee';
export type ModePaiement = 'carte' | 'virement';

export interface Reservation {
  id: number;
  tarifId: number;
  quantite: number;
  statut: ReservationStatus;
  modePaiement: ModePaiement;
  expireA: Date;
  montantTotal: string;
}

/** Hold vu par son auteur : état courant et, une fois payé, la commande créée. */
export interface HoldView extends Reservation {
  tarif: string | null;
  evenementId: number | null;
  evenement: string | null;
  commandeId: number | null;
  createdAt: Date;
}

/** Données du paiement à ouvrir, calculées par PostgreSQL à partir du prix figé du hold. */
export interface CheckoutPreparation {
  amountCents: number;
  quantite: number;
  tarif: string;
  evenementId: number;
  evenement: string;
  expireA: Date;
}

export interface ConfirmResult {
  commandeId: number;
  billetIds: number[];
}

/** Suite à donner au paiement d'un hold par carte. */
export type CheckoutResult =
  | { statut: 'paiement'; url: string }
  | { statut: 'confirmee'; commandeId: number; billetIds: number[] };

/** Virement attendu, vu par l'organisateur de l'événement : aucune donnée personnelle de l'acheteur. */
export interface PendingTransfer {
  id: number;
  tarif: string;
  evenementId: number;
  evenement: string;
  quantite: number;
  montantTotal: string;
  expireA: Date;
  createdAt: Date;
}

export interface TransferTarget {
  evenementId: number;
  utilisateurId: number;
  quantite: number;
  montantTotal: string;
}

export interface OrdersRepository {
  /** Rôle visiteur + app.user_id = userId attendus. */
  listForBuyer(tx: Tx, userId: number, pagination: Pagination): Promise<{ items: OrderSummary[]; total: number }>;
  findForBuyer(tx: Tx, userId: number, orderId: number): Promise<OrderDetail | null>;
  /** Rôle admin attendu. */
  findAny(tx: Tx, orderId: number): Promise<OrderDetail | null>;
  refundAsOwner(tx: Tx, orderId: number): Promise<void>;
  refundAsAdmin(tx: Tx, orderId: number): Promise<void>;
  /** Pose un hold (creer_reservation) : verrou anti-survente et plafond par utilisateur. */
  hold(tx: Tx, userId: number, tarifId: number, quantite: number, modePaiement: ModePaiement): Promise<Reservation>;
  listHoldsForBuyer(tx: Tx, userId: number): Promise<HoldView[]>;
  findHoldForBuyer(tx: Tx, userId: number, reservationId: number): Promise<HoldView | null>;
  /** preparer_paiement_reservation : vérifie et prolonge le hold, renvoie le montant dû. */
  prepareCheckout(tx: Tx, userId: number, reservationId: number): Promise<CheckoutPreparation>;
  /** confirmer_reservation_gratuite : uniquement pour un montant nul (BT035 sinon). */
  confirmFree(tx: Tx, userId: number, reservationId: number): Promise<ConfirmResult>;
  cancelHold(tx: Tx, userId: number, reservationId: number): Promise<void>;
  /** Rôle organisateur (RLS : ses tarifs) ou admin. */
  listPendingTransfers(tx: Tx): Promise<PendingTransfer[]>;
  findTransferTarget(tx: Tx, reservationId: number): Promise<TransferTarget | null>;
  /** valider_virement : organisateur de l'événement ou admin (BT013 sinon). */
  validateTransfer(tx: Tx, reservationId: number): Promise<ConfirmResult>;
}

export const ORDERS_REPOSITORY = Symbol('ORDERS_REPOSITORY');
