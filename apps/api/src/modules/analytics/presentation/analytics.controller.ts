import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import type { Actor } from '../../../auth/domain/actor';
import { Authenticated, CurrentActor } from '../../../auth/presentation/auth.decorators';
import { dateSchema, type Pagination, paginationSchema } from '../../../common/validation/schemas';
import { ZodPipe } from '../../../common/validation/zod.pipe';
import { AnalyticsUseCases } from '../application/analytics.use-cases';
import { EVENT_SALES_SORTS } from '../domain/analytics';

const DAY = 86_400_000;

const eventSalesQuerySchema = paginationSchema.extend({
  sort: z.enum(EVENT_SALES_SORTS).default('ca'),
});

const dailySalesQuerySchema = z
  .object({
    from: dateSchema.default(() => new Date(Date.now() - 30 * DAY)),
    to: dateSchema.default(() => new Date(Date.now() + DAY)),
  })
  .refine((q) => q.to > q.from, { message: 'to doit être postérieure à from', path: ['to'] })
  .refine((q) => q.to.getTime() - q.from.getTime() <= 366 * DAY, { message: 'période limitée à 366 jours', path: ['to'] });

const recentOrdersQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

@Controller('analytics')
@Authenticated('organizer', 'admin')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsUseCases) {}

  @Get('summary')
  summary(@CurrentActor() actor: Actor) {
    return this.analytics.summary(actor);
  }

  @Get('events')
  events(@CurrentActor() actor: Actor, @Query(new ZodPipe(eventSalesQuerySchema)) query: z.infer<typeof eventSalesQuerySchema>) {
    const { sort, ...pagination } = query;
    return this.analytics.eventSales(actor, sort, pagination);
  }

  @Get('venues')
  venues(@CurrentActor() actor: Actor, @Query(new ZodPipe(paginationSchema)) pagination: Pagination) {
    return this.analytics.venueRanking(actor, pagination);
  }

  @Get('daily-sales')
  dailySales(@CurrentActor() actor: Actor, @Query(new ZodPipe(dailySalesQuerySchema)) query: z.infer<typeof dailySalesQuerySchema>) {
    return this.analytics.dailySales(actor, query.from, query.to);
  }

  @Get('recent-orders')
  recentOrders(
    @CurrentActor() actor: Actor,
    @Query(new ZodPipe(recentOrdersQuerySchema)) query: z.infer<typeof recentOrdersQuerySchema>,
  ) {
    return this.analytics.recentOrders(actor, query.limit);
  }
}
