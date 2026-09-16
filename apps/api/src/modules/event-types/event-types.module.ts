import { Module } from '@nestjs/common';
import { GetEventTypeTreeUseCase } from './application/get-event-type-tree.use-case';
import { EVENT_TYPES_REPOSITORY } from './domain/event-type';
import { PrismaEventTypesRepository } from './infrastructure/prisma-event-types.repository';
import { EventTypesController } from './presentation/event-types.controller';

@Module({
  controllers: [EventTypesController],
  providers: [GetEventTypeTreeUseCase, { provide: EVENT_TYPES_REPOSITORY, useClass: PrismaEventTypesRepository }],
})
export class EventTypesModule {}
