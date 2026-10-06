import { Module } from '@nestjs/common';
import {
  ConfirmReservationUseCase,
  GetOrderUseCase,
  HoldOrderUseCase,
  ListMyOrdersUseCase,
  RefundOrderUseCase,
} from './application/orders.use-cases';
import { ORDERS_REPOSITORY } from './domain/order';
import { PrismaOrdersRepository } from './infrastructure/prisma-orders.repository';
import { ReservationsPurgeJob } from './infrastructure/reservations-purge.job';
import { OrdersController } from './presentation/orders.controller';

@Module({
  controllers: [OrdersController],
  providers: [
    ListMyOrdersUseCase,
    GetOrderUseCase,
    RefundOrderUseCase,
    HoldOrderUseCase,
    ConfirmReservationUseCase,
    ReservationsPurgeJob,
    { provide: ORDERS_REPOSITORY, useClass: PrismaOrdersRepository },
  ],
})
export class OrdersModule {}
