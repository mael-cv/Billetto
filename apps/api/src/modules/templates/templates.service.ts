import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { MongoService } from '../../common/mongodb/mongo.service';
import type { EventTemplateDocument, TicketTemplateDocument } from '../../common/mongodb/templates.types';
import { DEFAULT_EVENT_TEMPLATES, DEFAULT_TICKET_TEMPLATES } from './default-templates';

@Injectable()
export class TemplatesService implements OnModuleInit {
  private readonly logger = new Logger(TemplatesService.name);

  constructor(private readonly mongo: MongoService) {}

  async onModuleInit() {
    // Initialise les templates en arrière-plan dès que Mongo est prêt
    await this.seedDefaultTemplatesIfEmpty();
  }

  async seedDefaultTemplatesIfEmpty(): Promise<{ events: number; tickets: number }> {
    if (!this.mongo.isConnected || !this.mongo.eventTemplates || !this.mongo.ticketTemplates) {
      return { events: 0, tickets: 0 };
    }
    try {
      let eventsInserted = 0;
      let ticketsInserted = 0;

      const eventCount = await this.mongo.eventTemplates.countDocuments();
      if (eventCount === 0) {
        await this.mongo.eventTemplates.insertMany(DEFAULT_EVENT_TEMPLATES as EventTemplateDocument[]);
        eventsInserted = DEFAULT_EVENT_TEMPLATES.length;
        this.logger.log(`✓ ${eventsInserted} templates d'événements injectés dans MongoDB`);
      }

      const ticketCount = await this.mongo.ticketTemplates.countDocuments();
      if (ticketCount === 0) {
        await this.mongo.ticketTemplates.insertMany(DEFAULT_TICKET_TEMPLATES as TicketTemplateDocument[]);
        ticketsInserted = DEFAULT_TICKET_TEMPLATES.length;
        this.logger.log(`✓ ${ticketsInserted} templates de billets injectés dans MongoDB`);
      }

      return { events: eventsInserted, tickets: ticketsInserted };
    } catch (err) {
      this.logger.warn(`Impossible d'initialiser les templates Mongo : ${(err as Error).message}`);
      return { events: 0, tickets: 0 };
    }
  }

  async listEventTemplates(): Promise<EventTemplateDocument[]> {
    if (this.mongo.eventTemplates) {
      const items = await this.mongo.eventTemplates.find().toArray();
      if (items.length > 0) return items;
    }
    return DEFAULT_EVENT_TEMPLATES as EventTemplateDocument[];
  }

  async listTicketTemplates(): Promise<TicketTemplateDocument[]> {
    if (this.mongo.ticketTemplates) {
      const items = await this.mongo.ticketTemplates.find().toArray();
      if (items.length > 0) return items;
    }
    return DEFAULT_TICKET_TEMPLATES as TicketTemplateDocument[];
  }

  async getEventTemplate(templateId?: string): Promise<EventTemplateDocument> {
    const targetId = templateId?.toLowerCase().trim() || 'default';
    if (this.mongo.eventTemplates) {
      const found = await this.mongo.eventTemplates.findOne({ templateId: targetId });
      if (found) return found;
      const defaultDoc = await this.mongo.eventTemplates.findOne({ templateId: 'default' });
      if (defaultDoc) return defaultDoc;
    }
    return (
      (DEFAULT_EVENT_TEMPLATES.find((t) => t.templateId === targetId) as EventTemplateDocument) ??
      (DEFAULT_EVENT_TEMPLATES.find((t) => t.templateId === 'default') as EventTemplateDocument)
    );
  }

  async getTicketTemplate(templateId?: string): Promise<TicketTemplateDocument> {
    const targetId = templateId?.toLowerCase().trim() || 'default';
    if (this.mongo.ticketTemplates) {
      const found = await this.mongo.ticketTemplates.findOne({ templateId: targetId });
      if (found) return found;
      const defaultDoc = await this.mongo.ticketTemplates.findOne({ templateId: 'ticket-standard' });
      if (defaultDoc) return defaultDoc;
    }
    return (
      (DEFAULT_TICKET_TEMPLATES.find((t) => t.templateId === targetId) as TicketTemplateDocument) ??
      (DEFAULT_TICKET_TEMPLATES.find((t) => t.templateId === 'ticket-standard') as TicketTemplateDocument)
    );
  }

  /**
   * Résolution intelligente du template d'événement selon la catégorie SQL ou le titre
   */
  async resolveEventTemplate(categoryNom?: string, titre?: string): Promise<EventTemplateDocument> {
    const text = `${categoryNom ?? ''} ${titre ?? ''}`.toLowerCase();
    if (text.includes('fest')) return this.getEventTemplate('festival');
    if (text.includes('conc') || text.includes('rock') || text.includes('musique')) return this.getEventTemplate('concert');
    if (text.includes('conf') || text.includes('tech') || text.includes('data') || text.includes('bdd'))
      return this.getEventTemplate('conference');
    if (text.includes('theat') || text.includes('théâtre') || text.includes('spectacle') || text.includes('danse'))
      return this.getEventTemplate('theatre');
    return this.getEventTemplate('default');
  }

  /**
   * Résolution intelligente du template de billet selon le tarif et la catégorie
   */
  async resolveTicketTemplate(tarifNom?: string, eventTypeNom?: string): Promise<TicketTemplateDocument> {
    const tarif = (tarifNom ?? '').toLowerCase();
    const event = (eventTypeNom ?? '').toLowerCase();

    if (tarif.includes('vip') || tarif.includes('or') || tarif.includes('prestige')) {
      return this.getTicketTemplate('ticket-vip');
    }
    if (event.includes('fest') || tarif.includes('pass') || tarif.includes('3 jours')) {
      return this.getTicketTemplate('ticket-festival');
    }
    if (event.includes('conc') || tarif.includes('fosse')) {
      return this.getTicketTemplate('ticket-concert');
    }
    if (event.includes('conf') || tarif.includes('deleg') || tarif.includes('pro')) {
      return this.getTicketTemplate('ticket-conference');
    }
    return this.getTicketTemplate('ticket-standard');
  }
}
