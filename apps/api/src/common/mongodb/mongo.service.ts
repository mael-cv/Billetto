import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { type Collection, type Db, MongoClient } from 'mongodb';
import { APP_CONFIG, type AppConfig } from '../config/config';
import type { EventTemplateDocument, TicketTemplateDocument } from './templates.types';

@Injectable()
export class MongoService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MongoService.name);
  private client: MongoClient | null = null;
  private db: Db | null = null;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async onModuleInit() {
    try {
      this.client = new MongoClient(this.config.MONGO_URL, {
        serverSelectionTimeoutMS: 5000,
      });
      await this.client.connect();
      this.db = this.client.db();
      this.logger.log(`✓ Connecté à MongoDB (${this.db.databaseName})`);
      await this.ensureIndexes();
    } catch (err) {
      this.logger.warn(`Impossible de se connecter à MongoDB (${(err as Error).message}). Les templates par défaut seront utilisés.`);
    }
  }

  async onModuleDestroy() {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.db = null;
    }
  }

  get isConnected(): boolean {
    return this.db !== null;
  }

  getDatabase(): Db | null {
    return this.db;
  }

  get eventTemplates(): Collection<EventTemplateDocument> | null {
    return this.db ? this.db.collection<EventTemplateDocument>('event_templates') : null;
  }

  get ticketTemplates(): Collection<TicketTemplateDocument> | null {
    return this.db ? this.db.collection<TicketTemplateDocument>('ticket_templates') : null;
  }

  private async ensureIndexes() {
    if (!this.db) return;
    try {
      await this.eventTemplates?.createIndex({ templateId: 1 }, { unique: true });
      await this.ticketTemplates?.createIndex({ templateId: 1 }, { unique: true });
    } catch (err) {
      this.logger.warn(`Index MongoDB non créés : ${(err as Error).message}`);
    }
  }
}
