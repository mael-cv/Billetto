import { Module } from '@nestjs/common';
import {
  CreateEventUseCase,
  DeleteEventUseCase,
  GetEventUseCase,
  ListEventsUseCase,
  ReplaceEventAttributesUseCase,
  UpdateEventUseCase,
} from './application/events.use-cases';
import { EVENTS_REPOSITORY } from './domain/events.repository';
import { PrismaEventsRepository } from './infrastructure/prisma-events.repository';
import { EventsController } from './presentation/events.controller';

@Module({
  controllers: [EventsController],
  providers: [
    ListEventsUseCase,
    GetEventUseCase,
    CreateEventUseCase,
    UpdateEventUseCase,
    DeleteEventUseCase,
    ReplaceEventAttributesUseCase,
    { provide: EVENTS_REPOSITORY, useClass: PrismaEventsRepository },
  ],
  exports: [EVENTS_REPOSITORY],
})
export class EventsModule {}
