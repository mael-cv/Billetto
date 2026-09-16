import { Module } from '@nestjs/common';
import { ListOrderPaymentsUseCase } from './application/list-order-payments.use-case';
import { PAYMENTS_REPOSITORY } from './domain/payment';
import { PrismaPaymentsRepository } from './infrastructure/prisma-payments.repository';
import { PaymentsController } from './presentation/payments.controller';

@Module({
  controllers: [PaymentsController],
  providers: [ListOrderPaymentsUseCase, { provide: PAYMENTS_REPOSITORY, useClass: PrismaPaymentsRepository }],
})
export class PaymentsModule {}
