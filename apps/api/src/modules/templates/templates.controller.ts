import { Controller, Get, Param } from '@nestjs/common';
import { OptionalAuth } from '../../auth/presentation/auth.decorators';
import { TemplatesService } from './templates.service';

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
  getEvent(@Param('id') id: string) {
    return this.templates.getEventTemplate(id);
  }

  @Get('tickets')
  @OptionalAuth()
  listTickets() {
    return this.templates.listTicketTemplates();
  }

  @Get('tickets/:id')
  @OptionalAuth()
  getTicket(@Param('id') id: string) {
    return this.templates.getTicketTemplate(id);
  }
}
