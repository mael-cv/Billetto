import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { Actor } from '../../../auth/domain/actor';
import { toDbActor } from '../../../auth/domain/to-db-actor';
import { DbContextService } from '../../../common/database/db-context.service';
import { ApiError, notFound } from '../../../common/errors/http-errors';
import { type Page, toPage } from '../../../common/pagination';
import type { Pagination } from '../../../common/validation/schemas';
import type { EventDetail, EventFilters, EventInput, EventSummary } from '../domain/event';
import { EVENTS_REPOSITORY, type EventsRepository } from '../domain/events.repository';

@Injectable()
export class ListEventsUseCase {
  constructor(
    private readonly db: DbContextService,
    @Inject(EVENTS_REPOSITORY) private readonly events: EventsRepository,
  ) {}

  /**
   * Même requête pour tous : la RLS restreint le résultat (visiteur : publiés ;
   * organisateur : les siens ; admin : tous).
   */
  async execute(actor: Actor | null, filters: EventFilters, pagination: Pagination): Promise<Page<EventSummary>> {
    const { items, total } = await this.db.run(toDbActor(actor), (tx) => this.events.list(tx, filters, pagination));
    return toPage(items, total, pagination);
  }
}

@Injectable()
export class GetEventUseCase {
  constructor(
    private readonly db: DbContextService,
    @Inject(EVENTS_REPOSITORY) private readonly events: EventsRepository,
  ) {}

  async execute(actor: Actor | null, ref: { id: number } | { slug: string }): Promise<EventDetail> {
    const event = await this.db.run(toDbActor(actor), (tx) => this.events.findByRef(tx, ref));
    // Invisible (RLS) et inexistant sont indistinguables : 404 dans les deux cas.
    if (!event) throw notFound('Événement');
    return event;
  }
}

@Injectable()
export class CreateEventUseCase {
  constructor(
    private readonly db: DbContextService,
    @Inject(EVENTS_REPOSITORY) private readonly events: EventsRepository,
  ) {}

  async execute(actor: Actor, input: EventInput, requestedOrganisateurId?: number): Promise<EventDetail> {
    // Un organisateur crée toujours pour lui-même (et la policy WITH CHECK le garantit
    // aussi côté PostgreSQL) ; un admin doit préciser l'organisateur.
    const organisateurId = actor.role === 'admin' ? requestedOrganisateurId : actor.organisateurId;
    if (organisateurId === undefined || organisateurId === null) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION', 'organisateurId requis');
    }
    if (actor.role === 'organizer' && requestedOrganisateurId !== undefined && requestedOrganisateurId !== organisateurId) {
      throw new ApiError(HttpStatus.FORBIDDEN, 'ACCES_REFUSE', 'Création pour un autre organisateur interdite');
    }

    return this.db.run(toDbActor(actor), async (tx) => {
      const id = await this.events.create(tx, organisateurId, input);
      const created = await this.events.findByRef(tx, { id });
      if (!created) throw notFound('Événement');
      return created;
    });
  }
}

@Injectable()
export class UpdateEventUseCase {
  constructor(
    private readonly db: DbContextService,
    @Inject(EVENTS_REPOSITORY) private readonly events: EventsRepository,
  ) {}

  execute(actor: Actor, id: number, input: Partial<EventInput>): Promise<EventDetail> {
    return this.db.run(toDbActor(actor), async (tx) => {
      const count = await this.events.update(tx, id, input);
      if (count === 0) throw notFound('Événement');
      const updated = await this.events.findByRef(tx, { id });
      if (!updated) throw notFound('Événement');
      return updated;
    });
  }
}

@Injectable()
export class DeleteEventUseCase {
  constructor(
    private readonly db: DbContextService,
    @Inject(EVENTS_REPOSITORY) private readonly events: EventsRepository,
  ) {}

  async execute(actor: Actor, id: number): Promise<void> {
    const count = await this.db.run(toDbActor(actor), (tx) => this.events.delete(tx, id));
    if (count === 0) throw notFound('Événement');
  }
}
