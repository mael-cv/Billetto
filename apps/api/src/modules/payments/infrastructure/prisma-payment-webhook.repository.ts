import { Injectable } from '@nestjs/common';
import type { Tx } from '../../../common/database/db-context.service';
import { toNumber } from '../../../common/serialization';
import type {
  PaymentWebhookInput,
  PaymentWebhookRepository,
  PaymentWebhookResult,
} from '../domain/payment-webhook';

interface WebhookRow {
  duplique: boolean;
  commande_id: bigint | null;
  billet_ids: bigint[] | null;
}

@Injectable()
export class PrismaPaymentWebhookRepository implements PaymentWebhookRepository {
  async process(tx: Tx, input: PaymentWebhookInput): Promise<PaymentWebhookResult> {
    // payment.succeeded : type interne ; le montant encaissé est comparé au hold en base (BT035).
    const rows = await tx.$queryRaw<WebhookRow[]>`
      SELECT duplique, commande_id, billet_ids
      FROM traiter_paiement_webhook(
        ${input.eventId}::text,
        'payment.succeeded'::text,
        ${input.reservationId}::bigint,
        ${JSON.stringify(input.payload)}::jsonb,
        ${input.amountCents}::bigint
      )`;
    const row = rows[0];
    if (!row) throw new Error('traiter_paiement_webhook n’a renvoyé aucune ligne');
    return {
      duplicate: row.duplique,
      commandeId: row.commande_id === null ? null : toNumber(row.commande_id),
      billetIds: row.billet_ids?.map(toNumber) ?? null,
    };
  }
}
