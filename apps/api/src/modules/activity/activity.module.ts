import { Global, Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { ActivityLogger } from './activity-logger.service';
import { EventActivitySeriesUseCase, PurgeActivityUseCase, TrendingEventsUseCase } from './application/activity.use-cases';
import { ActivityController } from './presentation/activity.controller';

/** Global : ActivityLogger est injecté dans les contrôleurs métier (événements, check-in, auth, billets). */
@Global()
@Module({
  imports: [EventsModule],
  controllers: [ActivityController],
  providers: [ActivityLogger, TrendingEventsUseCase, EventActivitySeriesUseCase, PurgeActivityUseCase],
  exports: [ActivityLogger],
})
export class ActivityModule {}
