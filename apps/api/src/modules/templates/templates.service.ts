import { Injectable } from '@nestjs/common';
import { notFound } from '../../common/errors/http-errors';
import { MongoService } from '../../common/mongodb/mongo.service';
import type { EventTemplateDocument, TicketTemplateDocument } from '../../common/mongodb/templates.types';

/**
 * Templates visuels des événements et des billets, stockés dans MongoDB
 * (collections event_templates / ticket_templates, peuplées par
 * database/nosql/seed-nosql.mjs à partir de database/nosql/templates.mjs).
 */
@Injectable()
export class TemplatesService {
  constructor(private readonly mongo: MongoService) {}

  listEventTemplates(): Promise<EventTemplateDocument[]> {
    return this.mongo.eventTemplates.find().sort({ templateId: 1 }).toArray();
  }

  listTicketTemplates(): Promise<TicketTemplateDocument[]> {
    return this.mongo.ticketTemplates.find().sort({ templateId: 1 }).toArray();
  }

  /** Template d'événement par identifiant, avec repli sur `default`. */
  async getEventTemplate(templateId?: string): Promise<EventTemplateDocument> {
    const col = this.mongo.eventTemplates;
    const targetId = templateId?.toLowerCase().trim() || 'default';
    const found = (await col.findOne({ templateId: targetId })) ?? (await col.findOne({ templateId: 'default' }));
    if (!found) throw notFound("Template d'événement");
    return found;
  }

  /** Template de billet par identifiant, avec repli sur `ticket-standard`. */
  async getTicketTemplate(templateId?: string): Promise<TicketTemplateDocument> {
    const col = this.mongo.ticketTemplates;
    const targetId = templateId?.toLowerCase().trim() || 'ticket-standard';
    const found =
      (await col.findOne({ templateId: targetId })) ?? (await col.findOne({ templateId: 'ticket-standard' }));
    if (!found) throw notFound('Template de billet');
    return found;
  }

  /**
   * Template d'événement par défaut selon la catégorie SQL ou le titre
   * (utilisé quand la page éditoriale de l'événement n'en impose pas un).
   */
  resolveEventTemplate(categoryNom?: string, titre?: string): Promise<EventTemplateDocument> {
    const text = `${categoryNom ?? ''} ${titre ?? ''}`.toLowerCase();
    if (text.includes('fest')) return this.getEventTemplate('festival');
    if (text.includes('conc') || text.includes('rock') || text.includes('jazz') || text.includes('electro') || text.includes('musique')) {
      return this.getEventTemplate('concert');
    }
    if (text.includes('conf') || text.includes('tech') || text.includes('business') || text.includes('bdd')) {
      return this.getEventTemplate('conference');
    }
    if (text.includes('theat') || text.includes('théâtre') || text.includes('spectacle') || text.includes('danse') || text.includes('humour')) {
      return this.getEventTemplate('theatre');
    }
    return this.getEventTemplate('default');
  }

  /** Template de billet selon le tarif et la catégorie. */
  resolveTicketTemplate(tarifNom?: string, eventTypeNom?: string): Promise<TicketTemplateDocument> {
    const tarif = (tarifNom ?? '').toLowerCase();
    const event = (eventTypeNom ?? '').toLowerCase();
    if (tarif.includes('vip') || tarif.includes('or') || tarif.includes('prestige')) return this.getTicketTemplate('ticket-vip');
    if (event.includes('fest') || tarif.includes('pass') || tarif.includes('3 jours')) return this.getTicketTemplate('ticket-festival');
    if (event.includes('conc') || tarif.includes('fosse')) return this.getTicketTemplate('ticket-concert');
    if (event.includes('conf') || tarif.includes('deleg') || tarif.includes('pro')) return this.getTicketTemplate('ticket-conference');
    return this.getTicketTemplate('ticket-standard');
  }
}
