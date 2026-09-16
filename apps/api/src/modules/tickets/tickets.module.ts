import { Module } from '@nestjs/common';
import { ListMyTicketsUseCase, PurchaseTicketsUseCase } from './application/tickets.use-cases';
import { TICKETS_REPOSITORY } from './domain/ticket';
import { PrismaTicketsRepository } from './infrastructure/prisma-tickets.repository';
import { TicketsController } from './presentation/tickets.controller';

@Module({
  controllers: [TicketsController],
  providers: [
    PurchaseTicketsUseCase,
    ListMyTicketsUseCase,
    { provide: TICKETS_REPOSITORY, useClass: PrismaTicketsRepository },
  ],
})
export class TicketsModule {}
