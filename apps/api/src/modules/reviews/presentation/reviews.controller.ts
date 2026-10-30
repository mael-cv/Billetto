import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import type { Actor } from '../../../auth/domain/actor';
import { Authenticated, CurrentActor, Public } from '../../../auth/presentation/auth.decorators';
import { idSchema, type Pagination, paginationSchema } from '../../../common/validation/schemas';
import { ZodPipe } from '../../../common/validation/zod.pipe';
import { eventRefSchema } from '../../events/presentation/events.dto';
import {
  CreateReviewUseCase,
  DeleteReviewUseCase,
  ListOrganizerReviewsUseCase,
  ListReviewsUseCase,
  ReplyReviewUseCase,
  UpdateReviewUseCase,
} from '../application/reviews.use-cases';
import {
  type CreateReviewDto,
  createReviewSchema,
  type ListReviewsQuery,
  listReviewsQuerySchema,
  objectIdSchema,
  replySchema,
  type UpdateReviewDto,
  updateReviewSchema,
} from './reviews.dto';

/** Avis d'acheteurs (MongoDB) rattachés aux événements (PostgreSQL). */
@Controller()
export class ReviewsController {
  constructor(
    private readonly listReviews: ListReviewsUseCase,
    private readonly createReview: CreateReviewUseCase,
    private readonly updateReview: UpdateReviewUseCase,
    private readonly deleteReview: DeleteReviewUseCase,
    private readonly replyReview: ReplyReviewUseCase,
    private readonly listOrganizerReviews: ListOrganizerReviewsUseCase,
  ) {}

  @Get('events/:ref/avis')
  @Public()
  list(
    @Param('ref', new ZodPipe(eventRefSchema)) ref: { id: number } | { slug: string },
    @Query(new ZodPipe(listReviewsQuerySchema)) query: ListReviewsQuery,
  ) {
    const { page, pageSize, ...filters } = query;
    return this.listReviews.execute(ref, filters, { page, pageSize });
  }

  @Post('events/:id/avis')
  @HttpCode(201)
  @Authenticated()
  create(
    @CurrentActor() actor: Actor,
    @Param('id', new ZodPipe(idSchema)) id: number,
    @Body(new ZodPipe(createReviewSchema)) body: CreateReviewDto,
  ) {
    return this.createReview.execute(actor, id, body);
  }

  @Patch('avis/:id')
  @Authenticated()
  update(
    @CurrentActor() actor: Actor,
    @Param('id', new ZodPipe(objectIdSchema)) id: string,
    @Body(new ZodPipe(updateReviewSchema)) body: UpdateReviewDto,
  ) {
    return this.updateReview.execute(actor, id, body);
  }

  @Delete('avis/:id')
  @HttpCode(204)
  @Authenticated()
  async remove(@CurrentActor() actor: Actor, @Param('id', new ZodPipe(objectIdSchema)) id: string): Promise<void> {
    await this.deleteReview.execute(actor, id);
  }

  @Post('avis/:id/reponse')
  @HttpCode(200)
  @Authenticated('organizer', 'admin')
  reply(
    @CurrentActor() actor: Actor,
    @Param('id', new ZodPipe(objectIdSchema)) id: string,
    @Body(new ZodPipe(replySchema)) body: { texte: string },
  ) {
    return this.replyReview.execute(actor, id, body.texte);
  }

  @Get('organizer/avis')
  @Authenticated('organizer', 'admin')
  mine(
    @CurrentActor() actor: Actor,
    @Query(new ZodPipe(listReviewsQuerySchema)) query: ListReviewsQuery,
  ) {
    const pagination: Pagination = paginationSchema.parse({ page: query.page, pageSize: query.pageSize });
    return this.listOrganizerReviews.execute(actor, { sansReponse: query.sansReponse }, pagination);
  }
}
