import { Inject, Injectable } from '@nestjs/common';
import type { Actor } from '../../../auth/domain/actor';
import { DbContextService } from '../../../common/database/db-context.service';
import { notFound } from '../../../common/errors/http-errors';
import { type Payment, PAYMENTS_REPOSITORY, type PaymentsRepository } from '../domain/payment';

@Injectable()
export class ListOrderPaymentsUseCase {
  constructor(
    private readonly db: DbContextService,
    @Inject(PAYMENTS_REPOSITORY) private readonly payments: PaymentsRepository,
  ) {}

  /** Les organisateurs n'ont aucun droit sur paiements : seuls l'acheteur et l'admin y accèdent. */
  async execute(actor: Actor, orderId: number): Promise<Payment[]> {
    const payments =
      actor.role === 'admin'
        ? await this.db.run({ userId: actor.userId, role: 'admin' }, (tx) => this.payments.listForOrder(tx, orderId, null))
        : await this.db.asBuyer(actor.userId, (tx) => this.payments.listForOrder(tx, orderId, actor.userId));
    if (!payments) throw notFound('Commande');
    return payments;
  }
}
