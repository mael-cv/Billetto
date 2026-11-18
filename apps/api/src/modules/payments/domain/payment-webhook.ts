import type { Tx } from '../../../common/database/db-context.service';

/** Événement reçu du prestataire, signature déjà vérifiée. */
export interface PaymentWebhookEvent {
  eventId: string;
  type: string;
  sessionId: string;
}

/** Paiement confirmé auprès du prestataire, à enregistrer en base. */
export interface PaymentWebhookInput {
  eventId: string;
  reservationId: number;
  amountCents: number;
  payload: Record<string, unknown>;
}

export interface PaymentWebhookResult {
  duplicate: boolean;
  commandeId: number | null;
  billetIds: number[] | null;
}

export interface PaymentWebhookRepository {
  /** Rôle billetto_paiement attendu (DbContextService.asPaymentProcessor). */
  process(tx: Tx, input: PaymentWebhookInput): Promise<PaymentWebhookResult>;
}

export const PAYMENT_WEBHOOK_REPOSITORY = Symbol('PAYMENT_WEBHOOK_REPOSITORY');
