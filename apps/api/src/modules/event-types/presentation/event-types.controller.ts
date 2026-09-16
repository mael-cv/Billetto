import { Controller, Get } from '@nestjs/common';
import type { Actor } from '../../../auth/domain/actor';
import { CurrentActor } from '../../../auth/presentation/auth.decorators';
import { GetEventTypeTreeUseCase } from '../application/get-event-type-tree.use-case';

@Controller('event-types')
export class EventTypesController {
  constructor(private readonly getTree: GetEventTypeTreeUseCase) {}

  @Get('tree')
  tree(@CurrentActor() actor: Actor | null) {
    return this.getTree.execute(actor);
  }
}
