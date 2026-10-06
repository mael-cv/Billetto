import type { Tx } from '../../../common/database/db-context.service';

export interface PaymentWebhookInput {
  eventId: string;
  type: string;
  reservationId: number;
  payload: Record<string, unknown>;
}

export interface PaymentWebhookResult {
  duplicate: boolean;
  commandeId: number | null;
  billetIds: number[] | null;
}

export interface PaymentWebhookRepository {
  process(tx: Tx, input: PaymentWebhookInput): Promise<PaymentWebhookResult>;
}

export const PAYMENT_WEBHOOK_REPOSITORY = Symbol('PAYMENT_WEBHOOK_REPOSITORY');
