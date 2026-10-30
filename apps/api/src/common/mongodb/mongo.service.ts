import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { type Collection, type Db, MongoClient } from 'mongodb';
import { APP_CONFIG, type AppConfig } from '../config/config';
import type { ActiviteDocument, AvisDocument, EventPageDocument } from './documents.types';
import type { EventTemplateDocument, TicketTemplateDocument } from './templates.types';

/**
 * Connexion MongoDB (base documentaire). Comme PostgreSQL, la base est
 * obligatoire : l'API refuse de démarrer si elle est injoignable.
 * Le schéma (validateurs, index) appartient à database/nosql/schema.mjs,
 * appliqué par le conteneur init ; l'API ne crée aucun index.
 */
@Injectable()
export class MongoService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MongoService.name);
  private client: MongoClient | null = null;
  private db: Db | null = null;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async onModuleInit() {
    const client = new MongoClient(this.config.MONGO_URL, { serverSelectionTimeoutMS: 5000 });
    try {
      await client.connect();
      await client.db().admin().ping();
    } catch (err) {
      // L'URL contient le mot de passe : seul le message d'erreur est journalisé.
      throw new Error(`MongoDB injoignable : ${(err as Error).message}`);
    }
    this.client = client;
    this.db = client.db();
    this.logger.log(`Connecté à MongoDB (${this.db.databaseName})`);
  }

  async onModuleDestroy() {
    await this.client?.close();
    this.client = null;
    this.db = null;
  }

  /** Vérification de santé : ping serveur. */
  async ping(): Promise<boolean> {
    try {
      await this.database.admin().ping();
      return true;
    } catch {
      return false;
    }
  }

  get database(): Db {
    if (!this.db) throw new Error('MongoDB non initialisé');
    return this.db;
  }

  get eventTemplates(): Collection<EventTemplateDocument> {
    return this.database.collection<EventTemplateDocument>('event_templates');
  }

  get ticketTemplates(): Collection<TicketTemplateDocument> {
    return this.database.collection<TicketTemplateDocument>('ticket_templates');
  }

  get eventPages(): Collection<EventPageDocument> {
    return this.database.collection<EventPageDocument>('event_pages');
  }

  get avis(): Collection<AvisDocument> {
    return this.database.collection<AvisDocument>('avis');
  }

  get activites(): Collection<ActiviteDocument> {
    return this.database.collection<ActiviteDocument>('activites');
  }
}
