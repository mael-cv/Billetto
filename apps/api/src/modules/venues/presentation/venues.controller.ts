import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import type { Actor } from '../../../auth/domain/actor';
import { CurrentActor } from '../../../auth/presentation/auth.decorators';
import { paginationSchema } from '../../../common/validation/schemas';
import { ZodPipe } from '../../../common/validation/zod.pipe';
import { ListVenuesUseCase } from '../application/list-venues.use-case';

const listVenuesQuerySchema = paginationSchema.extend({
  ville: z.string().trim().min(1).max(100).optional(),
});

@Controller('venues')
export class VenuesController {
  constructor(private readonly listVenues: ListVenuesUseCase) {}

  @Get()
  list(
    @CurrentActor() actor: Actor | null,
    @Query(new ZodPipe(listVenuesQuerySchema)) query: z.infer<typeof listVenuesQuerySchema>,
  ) {
    return this.listVenues.execute(actor, query.ville, { page: query.page, pageSize: query.pageSize });
  }
}
