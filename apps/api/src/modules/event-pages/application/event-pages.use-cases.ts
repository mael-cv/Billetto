import { Inject, Injectable } from '@nestjs/common';
import type { Actor } from '../../../auth/domain/actor';
import { toDbActor } from '../../../auth/domain/to-db-actor';
import { DbContextService } from '../../../common/database/db-context.service';
import { notFound } from '../../../common/errors/http-errors';
import type { EventPageDocument } from '../../../common/mongodb/documents.types';
import { MongoService } from '../../../common/mongodb/mongo.service';
import type { EventTemplateDocument } from '../../../common/mongodb/templates.types';
import type { EventDetail } from '../../events/domain/event';
import { EVENTS_REPOSITORY, type EventsRepository } from '../../events/domain/events.repository';
import { catalogActor, type CatalogScope } from '../../events/application/events.use-cases';
import { TemplatesService } from '../../templates/templates.service';
import type { EventPageInput } from '../presentation/event-pages.dto';

/** Page éditoriale renvoyée au client : document Mongo (sans _id) + événement SQL + template. */
export interface EventPageView {
  evenement: EventDetail;
  page: Omit<EventPageDocument, '_id' | 'organisateurId'>;
  template: EventTemplateDocument;
  /** false : aucune page rédigée, contenu par défaut renvoyé. */
  personnalisee: boolean;
}

const sansId = (doc: EventPageDocument): EventPageView['page'] => ({
  evenementId: doc.evenementId,
  slug: doc.slug,
  templateId: doc.templateId,
  tags: doc.tags,
  programme: doc.programme,
  medias: doc.medias,
  sections: doc.sections,
  faq: doc.faq,
  updatedAt: doc.updatedAt,
});

/**
 * Lecture croisée : l'événement vient de PostgreSQL (RLS : un brouillon n'est
 * visible que par son organisateur), la page de MongoDB.
 */
@Injectable()
export class GetEventPageUseCase {
  constructor(
    private readonly db: DbContextService,
    @Inject(EVENTS_REPOSITORY) private readonly events: EventsRepository,
    private readonly mongo: MongoService,
    private readonly templates: TemplatesService,
  ) {}

  async execute(actor: Actor | null, scope: CatalogScope, ref: { id: number } | { slug: string }): Promise<EventPageView> {
    const evenement = await this.db.run(catalogActor(actor, scope), (tx) => this.events.findByRef(tx, ref));
    if (!evenement) throw notFound('Événement');

    const doc = await this.mongo.eventPages.findOne({ evenementId: evenement.id });
    const template = doc
      ? await this.templates.getEventTemplate(doc.templateId)
      : await this.templates.resolveEventTemplate(evenement.type.nom, evenement.nom);
    const page: EventPageView['page'] = doc
      ? sansId(doc)
      : {
          evenementId: evenement.id,
          slug: evenement.slug,
          templateId: template.templateId,
          tags: [],
          programme: [],
          medias: [],
          sections: template.sections,
          faq: template.faq,
          updatedAt: new Date(0),
        };
    return { evenement: { ...evenement, template }, page, template, personnalisee: doc !== null };
  }
}

/** Création ou remplacement de la page : l'organisateur propriétaire (RLS) ou un admin. */
@Injectable()
export class UpsertEventPageUseCase {
  constructor(
    private readonly db: DbContextService,
    @Inject(EVENTS_REPOSITORY) private readonly events: EventsRepository,
    private readonly mongo: MongoService,
    private readonly templates: TemplatesService,
  ) {}

  async execute(actor: Actor, evenementId: number, input: EventPageInput): Promise<EventPageView['page']> {
    // Visibilité « manage » : un organisateur ne voit que ses événements ; absent ⇒ 404.
    const evenement = await this.db.run(toDbActor(actor), (tx) => this.events.findByRef(tx, { id: evenementId }));
    if (!evenement) throw notFound('Événement');
    // Le template doit exister (404 sinon).
    const template = await this.templates.getEventTemplate(input.templateId);
    if (template.templateId !== input.templateId) throw notFound('Template');

    const doc: Omit<EventPageDocument, '_id'> = {
      evenementId: evenement.id,
      organisateurId: evenement.organisateurId,
      slug: evenement.slug,
      ...input,
      updatedAt: new Date(),
    };
    await this.mongo.eventPages.replaceOne({ evenementId: evenement.id }, doc, { upsert: true });
    const saved = await this.mongo.eventPages.findOne({ evenementId: evenement.id });
    if (!saved) throw notFound('Page');
    return sansId(saved);
  }
}

@Injectable()
export class DeleteEventPageUseCase {
  constructor(
    private readonly db: DbContextService,
    @Inject(EVENTS_REPOSITORY) private readonly events: EventsRepository,
    private readonly mongo: MongoService,
  ) {}

  async execute(actor: Actor, evenementId: number): Promise<void> {
    const evenement = await this.db.run(toDbActor(actor), (tx) => this.events.findByRef(tx, { id: evenementId }));
    if (!evenement) throw notFound('Événement');
    const { deletedCount } = await this.mongo.eventPages.deleteOne({ evenementId });
    if (deletedCount === 0) throw notFound('Page');
  }
}
