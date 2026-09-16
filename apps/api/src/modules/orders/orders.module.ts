import { Module } from '@nestjs/common';
import { GetOrderUseCase, ListMyOrdersUseCase, RefundOrderUseCase } from './application/orders.use-cases';
import { ORDERS_REPOSITORY } from './domain/order';
import { PrismaOrdersRepository } from './infrastructure/prisma-orders.repository';
import { OrdersController } from './presentation/orders.controller';

@Module({
  controllers: [OrdersController],
  providers: [
    ListMyOrdersUseCase,
    GetOrderUseCase,
    RefundOrderUseCase,
    { provide: ORDERS_REPOSITORY, useClass: PrismaOrdersRepository },
  ],
})
export class OrdersModule {}
