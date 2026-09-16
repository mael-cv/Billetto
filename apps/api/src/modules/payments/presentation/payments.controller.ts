import { Controller, Get, Param } from '@nestjs/common';
import type { Actor } from '../../../auth/domain/actor';
import { Authenticated, CurrentActor } from '../../../auth/presentation/auth.decorators';
import { idSchema } from '../../../common/validation/schemas';
import { ZodPipe } from '../../../common/validation/zod.pipe';
import { ListOrderPaymentsUseCase } from '../application/list-order-payments.use-case';

@Controller('orders/:id/payments')
@Authenticated()
export class PaymentsController {
  constructor(private readonly listPayments: ListOrderPaymentsUseCase) {}

  @Get()
  list(@CurrentActor() actor: Actor, @Param('id', new ZodPipe(idSchema)) orderId: number) {
    return this.listPayments.execute(actor, orderId);
  }
}
