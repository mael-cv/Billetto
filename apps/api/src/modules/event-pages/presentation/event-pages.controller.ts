import { Body, Controller, Delete, Get, HttpCode, Param, Put, Query } from '@nestjs/common';
import type { Actor } from '../../../auth/domain/actor';
import { Authenticated, CurrentActor, OptionalAuth } from '../../../auth/presentation/auth.decorators';
import { idSchema } from '../../../common/validation/schemas';
import { ZodPipe } from '../../../common/validation/zod.pipe';
import { eventRefSchema, type Scope, scopeQuerySchema } from '../../events/presentation/events.dto';
import { DeleteEventPageUseCase, GetEventPageUseCase, UpsertEventPageUseCase } from '../application/event-pages.use-cases';
import { type EventPageInput, eventPageSchema } from './event-pages.dto';

/** Page éditoriale (MongoDB) d'un événement (PostgreSQL). */
@Controller('events')
export class EventPagesController {
  constructor(
    private readonly getPage: GetEventPageUseCase,
    private readonly upsertPage: UpsertEventPageUseCase,
    private readonly deletePage: DeleteEventPageUseCase,
  ) {}

  @Get(':ref/page')
  @OptionalAuth()
  get(
    @CurrentActor() actor: Actor | null,
    @Param('ref', new ZodPipe(eventRefSchema)) ref: { id: number } | { slug: string },
    @Query(new ZodPipe(scopeQuerySchema)) query: { scope: Scope },
  ) {
    return this.getPage.execute(actor, query.scope, ref);
  }

  @Put(':id/page')
  @Authenticated('organizer', 'admin')
  put(
    @CurrentActor() actor: Actor,
    @Param('id', new ZodPipe(idSchema)) id: number,
    @Body(new ZodPipe(eventPageSchema)) body: EventPageInput,
  ) {
    return this.upsertPage.execute(actor, id, body);
  }

  @Delete(':id/page')
  @HttpCode(204)
  @Authenticated('organizer', 'admin')
  async remove(@CurrentActor() actor: Actor, @Param('id', new ZodPipe(idSchema)) id: number): Promise<void> {
    await this.deletePage.execute(actor, id);
  }
}
