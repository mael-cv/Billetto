import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import type { Actor } from '../../../auth/domain/actor';
import { Authenticated, CurrentActor } from '../../../auth/presentation/auth.decorators';
import { idSchema, type Pagination, paginationSchema } from '../../../common/validation/schemas';
import { ZodPipe } from '../../../common/validation/zod.pipe';
import {
  ConfirmReservationUseCase,
  GetOrderUseCase,
  HoldOrderUseCase,
  ListMyOrdersUseCase,
  RefundOrderUseCase,
} from '../application/orders.use-cases';

export const holdSchema = z.strictObject({
  tarifId: idSchema,
  // Bornes également vérifiées par creer_reservation (BT007).
  quantite: z.coerce.number().int().min(1).max(10),
  modePaiement: z.enum(['carte', 'virement']),
});

@Controller('orders')
@Authenticated()
export class OrdersController {
  constructor(
    private readonly listMine: ListMyOrdersUseCase,
    private readonly getOrder: GetOrderUseCase,
    private readonly refundOrder: RefundOrderUseCase,
    private readonly holdOrder: HoldOrderUseCase,
    private readonly confirmReservation: ConfirmReservationUseCase,
  ) {}

  @Get('me')
  me(@CurrentActor() actor: Actor, @Query(new ZodPipe(paginationSchema)) pagination: Pagination) {
    return this.listMine.execute(actor, pagination);
  }

  @Get(':id')
  get(@CurrentActor() actor: Actor, @Param('id', new ZodPipe(idSchema)) id: number) {
    return this.getOrder.execute(actor, id);
  }

  @Post(':id/refund')
  @HttpCode(200)
  refund(@CurrentActor() actor: Actor, @Param('id', new ZodPipe(idSchema)) id: number) {
    return this.refundOrder.execute(actor, id);
  }

  @Post('hold')
  @HttpCode(201)
  hold(@CurrentActor() actor: Actor, @Body(new ZodPipe(holdSchema)) body: z.infer<typeof holdSchema>) {
    return this.holdOrder.execute(actor, body.tarifId, body.quantite, body.modePaiement);
  }

  // :id est ici un id de RÉSERVATION (pas de commande, à la différence de
  // :id/refund ci-dessus) : confirmer_reservation crée la commande.
  @Post(':id/confirm')
  @HttpCode(200)
  confirm(@CurrentActor() actor: Actor, @Param('id', new ZodPipe(idSchema)) id: number) {
    return this.confirmReservation.execute(actor, id);
  }
}
