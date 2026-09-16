import { Inject, Injectable } from '@nestjs/common';
import type { Actor } from '../../../auth/domain/actor';
import { toDbActor } from '../../../auth/domain/to-db-actor';
import { DbContextService } from '../../../common/database/db-context.service';
import { EVENT_TYPES_REPOSITORY, type EventTypeNode, type EventTypesRepository } from '../domain/event-type';

@Injectable()
export class GetEventTypeTreeUseCase {
  constructor(
    private readonly db: DbContextService,
    @Inject(EVENT_TYPES_REPOSITORY) private readonly types: EventTypesRepository,
  ) {}

  execute(actor: Actor | null): Promise<EventTypeNode[]> {
    return this.db.run(toDbActor(actor), (tx) => this.types.tree(tx));
  }
}
