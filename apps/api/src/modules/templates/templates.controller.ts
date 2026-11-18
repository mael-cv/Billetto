import { Controller, Get, Param } from '@nestjs/common';
import { z } from 'zod';
import { OptionalAuth } from '../../auth/presentation/auth.decorators';
import { ZodPipe } from '../../common/validation/zod.pipe';
import { TemplatesService } from './templates.service';

/** Identifiant de template : même forme que les identifiants du seed (ex. « ticket-vip »). */
const templateIdSchema = z
  .string()
  .max(60)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'identifiant de template invalide');

@Controller('templates')
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  @Get('events')
  @OptionalAuth()
  listEvents() {
    return this.templates.listEventTemplates();
  }

  @Get('events/:id')
  @OptionalAuth()
  getEvent(@Param('id', new ZodPipe(templateIdSchema)) id: string) {
    return this.templates.getEventTemplate(id);
  }

  @Get('tickets')
  @OptionalAuth()
  listTickets() {
    return this.templates.listTicketTemplates();
  }

  @Get('tickets/:id')
  @OptionalAuth()
  getTicket(@Param('id', new ZodPipe(templateIdSchema)) id: string) {
    return this.templates.getTicketTemplate(id);
  }
}
