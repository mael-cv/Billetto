import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { DbContextService } from '../../../common/database/db-context.service';
import { ApiError } from '../../../common/errors/http-errors';
import { ActivityLogger } from '../../activity/activity-logger.service';
import { PAYMENT_GATEWAY, type PaymentGateway } from '../domain/payment-gateway';
import {
  PAYMENT_WEBHOOK_REPOSITORY,
  type PaymentWebhookEvent,
  type PaymentWebhookRepository,
} from '../domain/payment-webhook';

export interface WebhookOutcome {
  received: true;
  /** traite : billets émis ; doublon : événement déjà reçu ; ignore : rien à faire. */
  resultat: 'traite' | 'doublon' | 'ignore';
}

const IGNORED: WebhookOutcome = { received: true, resultat: 'ignore' };

@Injectable()
export class ProcessPaymentWebhookUseCase {
  constructor(
    private readonly db: DbContextService,
    @Inject(PAYMENT_WEBHOOK_REPOSITORY) private readonly webhooks: PaymentWebhookRepository,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    private readonly activity: ActivityLogger,
  ) {}

  async execute(event: PaymentWebhookEvent): Promise<WebhookOutcome> {
    if (event.type !== 'checkout.session.completed') return IGNORED;

    // Le corps du webhook n'est qu'un signal : l'état du paiement, le montant et
    // la réservation sont relus auprès du prestataire. Connaître le secret de
    // signature ne suffit donc pas à obtenir un billet.
    const session = await this.gateway.retrieveSession(event.sessionId);
    if (!session.paid || session.reservationId === null) return IGNORED;
    if (session.currency !== 'eur' || session.amountTotal < 0) {
      throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'PAIEMENT_INCOHERENT', 'Paiement incohérent');
    }
    const reservationId = session.reservationId;

    // traiter_paiement_webhook (SECURITY DEFINER) journalise l'événement, vérifie
    // le montant et confirme le hold dans une seule transaction PostgreSQL.
    const result = await this.db.asPaymentProcessor((tx) =>
      this.webhooks.process(tx, {
        eventId: event.eventId,
        reservationId,
        amountCents: session.amountTotal,
        payload: {
          stripeEventId: event.eventId,
          stripeSessionId: session.id,
          montantCentimes: session.amountTotal,
          devise: session.currency,
        },
      }),
    );
    if (result.duplicate) return { received: true, resultat: 'doublon' };

    this.activity.record('achat', {
      utilisateurId: session.userId,
      evenementId: session.evenementId,
      payload: { billets: result.billetIds?.length ?? 0, montant: session.amountTotal / 100, moyen: 'carte' },
    });
    return { received: true, resultat: 'traite' };
  }
}
