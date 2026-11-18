import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import type { Actor } from '../../../auth/domain/actor';
import { Authenticated, CurrentActor } from '../../../auth/presentation/auth.decorators';
import { idSchema, type Pagination, paginationSchema } from '../../../common/validation/schemas';
import { ZodPipe } from '../../../common/validation/zod.pipe';
import {
  CancelHoldUseCase,
  CheckoutHoldUseCase,
  GetHoldUseCase,
  GetOrderUseCase,
  HoldOrderUseCase,
  ListMyHoldsUseCase,
  ListMyOrdersUseCase,
  ListPendingTransfersUseCase,
  RefundOrderUseCase,
  ValidateTransferUseCase,
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
    private readonly listMyHolds: ListMyHoldsUseCase,
    private readonly getHold: GetHoldUseCase,
    private readonly checkoutHold: CheckoutHoldUseCase,
    private readonly cancelHold: CancelHoldUseCase,
    private readonly listTransfers: ListPendingTransfersUseCase,
    private readonly validateTransfer: ValidateTransferUseCase,
  ) {}

  @Get('me')
  me(@CurrentActor() actor: Actor, @Query(new ZodPipe(paginationSchema)) pagination: Pagination) {
    return this.listMine.execute(actor, pagination);
  }

  // --- Réservations temporaires (holds). Aucune route ne permet à l'acheteur
  // de transformer lui-même un hold payant en commande : seuls le webhook de
  // paiement signé et la validation d'un virement par l'organisateur le font.

  @Post('hold')
  @HttpCode(201)
  hold(@CurrentActor() actor: Actor, @Body(new ZodPipe(holdSchema)) body: z.infer<typeof holdSchema>) {
    return this.holdOrder.execute(actor, body.tarifId, body.quantite, body.modePaiement);
  }

  @Get('holds/me')
  myHolds(@CurrentActor() actor: Actor) {
    return this.listMyHolds.execute(actor);
  }

  /** Virements attendus sur les événements de l'organisateur (tous pour un admin). */
  @Get('holds/transfers')
  @Authenticated('organizer', 'admin')
  transfers(@CurrentActor() actor: Actor) {
    return this.listTransfers.execute(actor);
  }

  @Get('holds/:id')
  holdStatus(@CurrentActor() actor: Actor, @Param('id', new ZodPipe(idSchema)) id: number) {
    return this.getHold.execute(actor, id);
  }

  /** Ouvre le paiement par carte : renvoie l'URL de la page de paiement du prestataire. */
  @Post('holds/:id/checkout')
  @HttpCode(200)
  checkout(@CurrentActor() actor: Actor, @Param('id', new ZodPipe(idSchema)) id: number) {
    return this.checkoutHold.execute(actor, id);
  }

  @Delete('holds/:id')
  @HttpCode(204)
  async cancel(@CurrentActor() actor: Actor, @Param('id', new ZodPipe(idSchema)) id: number): Promise<void> {
    await this.cancelHold.execute(actor, id);
  }

  @Post('holds/:id/validate-transfer')
  @Authenticated('organizer', 'admin')
  @HttpCode(200)
  validate(@CurrentActor() actor: Actor, @Param('id', new ZodPipe(idSchema)) id: number) {
    return this.validateTransfer.execute(actor, id);
  }

  // --- Commandes

  @Get(':id')
  get(@CurrentActor() actor: Actor, @Param('id', new ZodPipe(idSchema)) id: number) {
    return this.getOrder.execute(actor, id);
  }

  @Post(':id/refund')
  @HttpCode(200)
  refund(@CurrentActor() actor: Actor, @Param('id', new ZodPipe(idSchema)) id: number) {
    return this.refundOrder.execute(actor, id);
  }
}
