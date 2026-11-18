import { Controller, Get, Query } from '@nestjs/common';
import type { Actor } from '../../../auth/domain/actor';
import { Authenticated, CurrentActor } from '../../../auth/presentation/auth.decorators';
import { type Pagination, paginationSchema } from '../../../common/validation/schemas';
import { ZodPipe } from '../../../common/validation/zod.pipe';
import { ListMyTicketsUseCase } from '../application/tickets.use-cases';

// Aucun achat direct ici : un billet n'est émis qu'après paiement vérifié
// (webhook) ou virement validé — voir le module des commandes (holds).
@Controller('tickets')
@Authenticated()
export class TicketsController {
  constructor(private readonly listMine: ListMyTicketsUseCase) {}

  @Get('me')
  me(@CurrentActor() actor: Actor, @Query(new ZodPipe(paginationSchema)) pagination: Pagination) {
    return this.listMine.execute(actor, pagination);
  }
}
