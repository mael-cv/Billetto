import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import {
  CreateReviewUseCase,
  DeleteReviewUseCase,
  ListOrganizerReviewsUseCase,
  ListReviewsUseCase,
  ReplyReviewUseCase,
  UpdateReviewUseCase,
} from './application/reviews.use-cases';
import { ReviewsController } from './presentation/reviews.controller';

@Module({
  imports: [EventsModule],
  controllers: [ReviewsController],
  providers: [
    ListReviewsUseCase,
    CreateReviewUseCase,
    UpdateReviewUseCase,
    DeleteReviewUseCase,
    ReplyReviewUseCase,
    ListOrganizerReviewsUseCase,
  ],
})
export class ReviewsModule {}
