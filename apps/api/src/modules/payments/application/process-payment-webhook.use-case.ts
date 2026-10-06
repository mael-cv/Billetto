import { Inject, Injectable } from '@nestjs/common';
import { DbContextService } from '../../../common/database/db-context.service';
import {
  PAYMENT_WEBHOOK_REPOSITORY,
  type PaymentWebhookInput,
  type PaymentWebhookRepository,
} from '../domain/payment-webhook';

@Injectable()
export class ProcessPaymentWebhookUseCase {
  constructor(
    private readonly db: DbContextService,
    @Inject(PAYMENT_WEBHOOK_REPOSITORY) private readonly webhooks: PaymentWebhookRepository,
  ) {}

  execute(input: PaymentWebhookInput) {
    // Le traitement SECURITY DEFINER écrit l'événement et confirme le hold dans
    // cette même transaction PostgreSQL. Aucun droit d'écriture n'est accordé
    // directement au rôle visiteur.
    return this.db.run({ userId: null, role: 'visitor' }, (tx) => this.webhooks.process(tx, input));
  }
}
