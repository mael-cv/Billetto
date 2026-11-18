import { Inject, Injectable } from '@nestjs/common';
import type { Actor } from '../../../auth/domain/actor';
import { DbContextService } from '../../../common/database/db-context.service';
import type { TicketTemplateDocument } from '../../../common/mongodb/templates.types';
import { type Page, toPage } from '../../../common/pagination';
import type { Pagination } from '../../../common/validation/schemas';
import { type MyTicket, TICKETS_REPOSITORY, type TicketsRepository } from '../domain/ticket';
import { TemplatesService } from '../../templates/templates.service';

@Injectable()
export class ListMyTicketsUseCase {
  constructor(
    private readonly db: DbContextService,
    @Inject(TICKETS_REPOSITORY) private readonly tickets: TicketsRepository,
    private readonly templates: TemplatesService,
  ) {}

  async execute(actor: Actor, pagination: Pagination): Promise<Page<MyTicket>> {
    const { items, total } = await this.db.asBuyer(actor.userId, (tx) =>
      this.tickets.listForUser(tx, actor.userId, pagination),
    );
    // Un template par couple (tarif, événement) distinct : une page de 100 billets
    // ne déclenche pas 100 lectures MongoDB.
    const resolved = new Map<string, Promise<TicketTemplateDocument>>();
    const templateOf = (tarif: string, evenement: string) => {
      const key = `${tarif}\u0000${evenement}`;
      let template = resolved.get(key);
      if (!template) {
        template = this.templates.resolveTicketTemplate(tarif, evenement);
        resolved.set(key, template);
      }
      return template;
    };
    const enriched = await Promise.all(
      items.map(async (t) => ({ ...t, template: await templateOf(t.tarif, t.evenement) })),
    );
    return toPage(enriched, total, pagination);
  }
}
