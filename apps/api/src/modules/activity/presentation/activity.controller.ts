import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import type { Actor } from '../../../auth/domain/actor';
import { Authenticated, CurrentActor, OptionalAuth, Public } from '../../../auth/presentation/auth.decorators';
import { dateSchema, idSchema } from '../../../common/validation/schemas';
import { ZodPipe } from '../../../common/validation/zod.pipe';
import { ActivityLogger } from '../activity-logger.service';
import { EventActivitySeriesUseCase, PurgeActivityUseCase, TrendingEventsUseCase } from '../application/activity.use-cases';

export const trendingQuerySchema = z.strictObject({
  jours: z.coerce.number().int().min(1).max(90).default(7),
  limit: z.coerce.number().int().min(1).max(50).default(8),
});

export const seriesQuerySchema = z.strictObject({
  granularite: z.enum(['heure', 'jour']).default('jour'),
  jours: z.coerce.number().int().min(1).max(90).default(14),
});

/** Activités que le navigateur peut déclarer lui-même ; les autres sont émises par l'API. */
export const clientActivitySchema = z.strictObject({
  type: z.enum(['vue_evenement', 'recherche']),
  evenementId: idSchema.optional(),
  payload: z.record(z.string().max(40), z.union([z.string().max(200), z.number(), z.boolean()])).default({}),
});

export const purgeQuerySchema = z.strictObject({ avant: dateSchema });

@Controller()
export class ActivityController {
  constructor(
    private readonly trending: TrendingEventsUseCase,
    private readonly series: EventActivitySeriesUseCase,
    private readonly purge: PurgeActivityUseCase,
    private readonly activity: ActivityLogger,
  ) {}

  /** Lecture croisée MongoDB (score) → PostgreSQL (événements publiés). */
  @Get('events/tendances')
  @Public()
  tendances(@Query(new ZodPipe(trendingQuerySchema)) query: z.infer<typeof trendingQuerySchema>) {
    return this.trending.execute(query.jours, query.limit);
  }

  /** Écriture explicite depuis le front (vue de page, recherche). */
  @Post('activites')
  @HttpCode(201)
  @OptionalAuth()
  async record(@CurrentActor() actor: Actor | null, @Body(new ZodPipe(clientActivitySchema)) body: z.infer<typeof clientActivitySchema>) {
    const id = await this.activity.recordNow(body.type, {
      utilisateurId: actor?.userId ?? null,
      evenementId: body.evenementId ?? null,
      payload: { ...body.payload, source: 'client' },
    });
    return { id };
  }

  @Get('activites/evenements/:id')
  @Authenticated('organizer', 'admin')
  serie(
    @CurrentActor() actor: Actor,
    @Param('id', new ZodPipe(idSchema)) id: number,
    @Query(new ZodPipe(seriesQuerySchema)) query: z.infer<typeof seriesQuerySchema>,
  ) {
    return this.series.execute(actor, id, query.granularite === 'heure' ? 'hour' : 'day', query.jours);
  }

  @Delete('activites')
  @Authenticated('admin')
  purger(@Query(new ZodPipe(purgeQuerySchema)) query: z.infer<typeof purgeQuerySchema>) {
    return this.purge.execute(query.avant);
  }
}
