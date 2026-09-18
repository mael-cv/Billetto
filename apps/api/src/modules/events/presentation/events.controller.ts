import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { Authenticated, CurrentActor } from '../../../auth/presentation/auth.decorators';
import type { Actor } from '../../../auth/domain/actor';
import { idSchema } from '../../../common/validation/schemas';
import { ZodPipe } from '../../../common/validation/zod.pipe';
import {
  CreateEventUseCase,
  DeleteEventUseCase,
  GetEventUseCase,
  ListEventsUseCase,
  ReplaceEventAttributesUseCase,
  UpdateEventUseCase,
} from '../application/events.use-cases';
import {
  attributesSchema,
  type CreateEventDto,
  createEventSchema,
  eventRefSchema,
  type ListEventsQuery,
  listEventsQuerySchema,
  type Scope,
  scopeQuerySchema,
  type UpdateEventDto,
  updateEventSchema,
} from './events.dto';

@Controller('events')
export class EventsController {
  constructor(
    private readonly listEvents: ListEventsUseCase,
    private readonly getEvent: GetEventUseCase,
    private readonly createEvent: CreateEventUseCase,
    private readonly updateEvent: UpdateEventUseCase,
    private readonly deleteEvent: DeleteEventUseCase,
    private readonly replaceAttributes: ReplaceEventAttributesUseCase,
  ) {}

  @Get()
  list(@CurrentActor() actor: Actor | null, @Query(new ZodPipe(listEventsQuerySchema)) query: ListEventsQuery) {
    const { page, pageSize, scope, ...filters } = query;
    return this.listEvents.execute(actor, scope, filters, { page, pageSize });
  }

  @Get(':ref')
  get(
    @CurrentActor() actor: Actor | null,
    @Param('ref', new ZodPipe(eventRefSchema)) ref: { id: number } | { slug: string },
    @Query(new ZodPipe(scopeQuerySchema)) query: { scope: Scope },
  ) {
    return this.getEvent.execute(actor, query.scope, ref);
  }

  @Post()
  @Authenticated('organizer', 'admin')
  create(@CurrentActor() actor: Actor, @Body(new ZodPipe(createEventSchema)) body: CreateEventDto) {
    const { organisateurId, ...input } = body;
    return this.createEvent.execute(actor, input, organisateurId);
  }

  @Patch(':id')
  @Authenticated('organizer', 'admin')
  update(
    @CurrentActor() actor: Actor,
    @Param('id', new ZodPipe(idSchema)) id: number,
    @Body(new ZodPipe(updateEventSchema)) body: UpdateEventDto,
  ) {
    return this.updateEvent.execute(actor, id, body);
  }

  @Put(':id/attributes')
  @Authenticated('organizer', 'admin')
  putAttributes(
    @CurrentActor() actor: Actor,
    @Param('id', new ZodPipe(idSchema)) id: number,
    @Body(new ZodPipe(attributesSchema)) body: { cle: string; valeur: string }[],
  ) {
    return this.replaceAttributes.execute(actor, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @Authenticated('organizer', 'admin')
  async remove(@CurrentActor() actor: Actor, @Param('id', new ZodPipe(idSchema)) id: number): Promise<void> {
    await this.deleteEvent.execute(actor, id);
  }
}
