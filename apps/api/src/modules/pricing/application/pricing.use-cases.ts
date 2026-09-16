import { Inject, Injectable } from '@nestjs/common';
import type { Actor } from '../../../auth/domain/actor';
import { toDbActor } from '../../../auth/domain/to-db-actor';
import { DbContextService } from '../../../common/database/db-context.service';
import { notFound } from '../../../common/errors/http-errors';
import type { PriceInput, TicketPrice } from '../domain/price';
import { PRICING_REPOSITORY, type PricingRepository } from '../domain/pricing.repository';

@Injectable()
export class ListPricesUseCase {
  constructor(
    private readonly db: DbContextService,
    @Inject(PRICING_REPOSITORY) private readonly prices: PricingRepository,
  ) {}

  execute(actor: Actor | null, eventId: number): Promise<TicketPrice[]> {
    return this.db.run(toDbActor(actor), async (tx) => {
      if (!(await this.prices.eventVisible(tx, eventId))) throw notFound('Événement');
      return this.prices.listForEvent(tx, eventId);
    });
  }
}

@Injectable()
export class CreatePriceUseCase {
  constructor(
    private readonly db: DbContextService,
    @Inject(PRICING_REPOSITORY) private readonly prices: PricingRepository,
  ) {}

  execute(actor: Actor, eventId: number, input: PriceInput): Promise<TicketPrice> {
    return this.db.run(toDbActor(actor), async (tx) => {
      // Vérification explicite pour répondre 404 ; la policy WITH CHECK refuserait de toute façon.
      if (!(await this.prices.eventVisible(tx, eventId))) throw notFound('Événement');
      const id = await this.prices.create(tx, eventId, input);
      const created = await this.prices.findById(tx, id);
      if (!created) throw notFound('Tarif');
      return created;
    });
  }
}

@Injectable()
export class UpdatePriceUseCase {
  constructor(
    private readonly db: DbContextService,
    @Inject(PRICING_REPOSITORY) private readonly prices: PricingRepository,
  ) {}

  /** Modifier prix ou quota déclenche l'audit journal_tarifs (trigger, auteur = app.user_id). */
  execute(actor: Actor, id: number, input: Partial<PriceInput>): Promise<TicketPrice> {
    return this.db.run(toDbActor(actor), async (tx) => {
      if ((await this.prices.update(tx, id, input)) === 0) throw notFound('Tarif');
      const updated = await this.prices.findById(tx, id);
      if (!updated) throw notFound('Tarif');
      return updated;
    });
  }
}

@Injectable()
export class DeletePriceUseCase {
  constructor(
    private readonly db: DbContextService,
    @Inject(PRICING_REPOSITORY) private readonly prices: PricingRepository,
  ) {}

  async execute(actor: Actor, id: number): Promise<void> {
    const count = await this.db.run(toDbActor(actor), (tx) => this.prices.delete(tx, id));
    if (count === 0) throw notFound('Tarif');
  }
}
