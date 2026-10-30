import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { DeleteEventPageUseCase, GetEventPageUseCase, UpsertEventPageUseCase } from './application/event-pages.use-cases';
import { EventPagesController } from './presentation/event-pages.controller';

@Module({
  imports: [EventsModule],
  controllers: [EventPagesController],
  providers: [GetEventPageUseCase, UpsertEventPageUseCase, DeleteEventPageUseCase],
})
export class EventPagesModule {}
