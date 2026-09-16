import { Inject, Injectable } from '@nestjs/common';
import type { Actor } from '../../../auth/domain/actor';
import { DbContextService } from '../../../common/database/db-context.service';
import { type Page, toPage } from '../../../common/pagination';
import type { Pagination } from '../../../common/validation/schemas';
import { type MyTicket, type PurchaseResult, TICKETS_REPOSITORY, type TicketsRepository } from '../domain/ticket';

@Injectable()
export class PurchaseTicketsUseCase {
  constructor(
    private readonly db: DbContextService,
    @Inject(TICKETS_REPOSITORY) private readonly tickets: TicketsRepository,
  ) {}

  /**
   * Aucune règle métier ici : pas de lecture du quota, pas de calcul de prix.
   * acheter_billet() contrôle tarif, dates, quota (verrou) et crée commande,
   * paiement et billets dans une seule transaction. Ses erreurs BTxxx sont
   * traduites en HTTP par le filtre global.
   */
  execute(actor: Actor, tarifId: number, quantite: number): Promise<PurchaseResult> {
    return this.db.asBuyer(actor.userId, (tx) => this.tickets.purchase(tx, actor.userId, tarifId, quantite));
  }
}

@Injectable()
export class ListMyTicketsUseCase {
  constructor(
    private readonly db: DbContextService,
    @Inject(TICKETS_REPOSITORY) private readonly tickets: TicketsRepository,
  ) {}

  async execute(actor: Actor, pagination: Pagination): Promise<Page<MyTicket>> {
    const { items, total } = await this.db.asBuyer(actor.userId, (tx) =>
      this.tickets.listForUser(tx, actor.userId, pagination),
    );
    return toPage(items, total, pagination);
  }
}
