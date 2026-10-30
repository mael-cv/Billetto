import { HttpStatus, Injectable } from '@nestjs/common';
import { ApiError, notFound } from '../../common/errors/http-errors';
import { MongoService } from '../../common/mongodb/mongo.service';
import type { EventTemplateDocument, TicketTemplateDocument } from '../../common/mongodb/templates.types';

const nosqlUnavailable = (): ApiError =>
  new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'NOSQL_INDISPONIBLE', 'Base documentaire (MongoDB) indisponible');

/**
 * Templates visuels des événements et des billets, stockés dans MongoDB.
 * Les documents par défaut sont créés par `database/scripts/init-auto.mjs`
 * (`database/nosql/seed-nosql.mjs`, templates dans `database/nosql/templates.mjs`) ; l'API ne conserve aucun repli en mémoire.
 */
@Injectable()
export class TemplatesService {
  constructor(private readonly mongo: MongoService) {}

  async listEventTemplates(): Promise<EventTemplateDocument[]> {
    const col = this.mongo.eventTemplates;
    if (!col) throw nosqlUnavailable();
    return col.find().sort({ templateId: 1 }).toArray();
  }

  async listTicketTemplates(): Promise<TicketTemplateDocument[]> {
    const col = this.mongo.ticketTemplates;
    if (!col) throw nosqlUnavailable();
    return col.find().sort({ templateId: 1 }).toArray();
  }

  /** Template d'événement par identifiant, avec repli sur `default`. */
  async getEventTemplate(templateId?: string): Promise<EventTemplateDocument> {
    const col = this.mongo.eventTemplates;
    if (!col) throw nosqlUnavailable();
    const targetId = templateId?.toLowerCase().trim() || 'default';
    const found = (await col.findOne({ templateId: targetId })) ?? (await col.findOne({ templateId: 'default' }));
    if (!found) throw notFound("Template d'événement");
    return found;
  }

  /** Template de billet par identifiant, avec repli sur `ticket-standard`. */
  async getTicketTemplate(templateId?: string): Promise<TicketTemplateDocument> {
    const col = this.mongo.ticketTemplates;
    if (!col) throw nosqlUnavailable();
    const targetId = templateId?.toLowerCase().trim() || 'ticket-standard';
    const found =
      (await col.findOne({ templateId: targetId })) ?? (await col.findOne({ templateId: 'ticket-standard' }));
    if (!found) throw notFound('Template de billet');
    return found;
  }

  /** Résolution du template d'événement selon la catégorie SQL ou le titre. */
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

  /** Résolution du template de billet selon le tarif et la catégorie. */
  async resolveTicketTemplate(tarifNom?: string, eventTypeNom?: string): Promise<TicketTemplateDocument> {
    const tarif = (tarifNom ?? '').toLowerCase();
    const event = (eventTypeNom ?? '').toLowerCase();
    if (tarif.includes('vip') || tarif.includes('or') || tarif.includes('prestige')) return this.getTicketTemplate('ticket-vip');
    if (event.includes('fest') || tarif.includes('pass') || tarif.includes('3 jours')) return this.getTicketTemplate('ticket-festival');
    if (event.includes('conc') || tarif.includes('fosse')) return this.getTicketTemplate('ticket-concert');
    if (event.includes('conf') || tarif.includes('deleg') || tarif.includes('pro')) return this.getTicketTemplate('ticket-conference');
    return this.getTicketTemplate('ticket-standard');
  }
}
