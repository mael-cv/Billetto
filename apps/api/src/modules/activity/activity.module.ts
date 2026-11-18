import { Global, Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { ActivityLogger } from './activity-logger.service';
import {
  AssertPublicEventUseCase,
  EventActivitySeriesUseCase,
  PurgeActivityUseCase,
  TrendingEventsUseCase,
} from './application/activity.use-cases';
import { ActivityController } from './presentation/activity.controller';

/** Global : ActivityLogger est injecté dans les contrôleurs métier (événements, check-in, auth, billets). */
@Global()
@Module({
  imports: [EventsModule],
  controllers: [ActivityController],
  providers: [
    ActivityLogger,
    TrendingEventsUseCase,
    EventActivitySeriesUseCase,
    PurgeActivityUseCase,
    AssertPublicEventUseCase,
  ],
  exports: [ActivityLogger],
})
export class ActivityModule {}
