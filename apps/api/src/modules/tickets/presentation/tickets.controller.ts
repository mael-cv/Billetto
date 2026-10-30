import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import type { Actor } from '../../../auth/domain/actor';
import { Authenticated, CurrentActor } from '../../../auth/presentation/auth.decorators';
import { idSchema, type Pagination, paginationSchema } from '../../../common/validation/schemas';
import { ZodPipe } from '../../../common/validation/zod.pipe';
import { ActivityLogger } from '../../activity/activity-logger.service';
import { ListMyTicketsUseCase, PurchaseTicketsUseCase } from '../application/tickets.use-cases';

export const purchaseSchema = z.strictObject({
  tarifId: idSchema,
  // Borne également vérifiée par acheter_billet (BT007).
  quantite: z.coerce.number().int().min(1).max(10),
});

@Controller('tickets')
@Authenticated()
export class TicketsController {
  constructor(
    private readonly purchaseTickets: PurchaseTicketsUseCase,
    private readonly listMine: ListMyTicketsUseCase,
    private readonly activity: ActivityLogger,
  ) {}

  @Post('purchase')
  @HttpCode(201)
  async purchase(@CurrentActor() actor: Actor, @Body(new ZodPipe(purchaseSchema)) body: z.infer<typeof purchaseSchema>) {
    const result = await this.purchaseTickets.execute(actor, body.tarifId, body.quantite);
    this.activity.record('achat', {
      utilisateurId: actor.userId,
      evenementId: result.evenementId,
      payload: { billets: body.quantite, montant: Number(result.montantTotal), moyen: 'carte' },
    });
    return result;
  }

  @Get('me')
  me(@CurrentActor() actor: Actor, @Query(new ZodPipe(paginationSchema)) pagination: Pagination) {
    return this.listMine.execute(actor, pagination);
  }
}
