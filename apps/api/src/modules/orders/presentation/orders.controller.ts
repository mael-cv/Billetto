import { Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import type { Actor } from '../../../auth/domain/actor';
import { Authenticated, CurrentActor } from '../../../auth/presentation/auth.decorators';
import { idSchema, type Pagination, paginationSchema } from '../../../common/validation/schemas';
import { ZodPipe } from '../../../common/validation/zod.pipe';
import { GetOrderUseCase, ListMyOrdersUseCase, RefundOrderUseCase } from '../application/orders.use-cases';

@Controller('orders')
@Authenticated()
export class OrdersController {
  constructor(
    private readonly listMine: ListMyOrdersUseCase,
    private readonly getOrder: GetOrderUseCase,
    private readonly refundOrder: RefundOrderUseCase,
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
}
