import { Inject, Injectable } from '@nestjs/common';
import type { Actor } from '../../../auth/domain/actor';
import { toDbActor } from '../../../auth/domain/to-db-actor';
import { DbContextService } from '../../../common/database/db-context.service';
import { type Page, toPage } from '../../../common/pagination';
import type { Pagination } from '../../../common/validation/schemas';
import { type Venue, VENUES_REPOSITORY, type VenuesRepository } from '../domain/venue';

@Injectable()
export class ListVenuesUseCase {
  constructor(
    private readonly db: DbContextService,
    @Inject(VENUES_REPOSITORY) private readonly venues: VenuesRepository,
  ) {}

  async execute(actor: Actor | null, ville: string | undefined, pagination: Pagination): Promise<Page<Venue>> {
    const { items, total } = await this.db.run(toDbActor(actor), (tx) => this.venues.list(tx, ville, pagination));
    return toPage(items, total, pagination);
  }
}
