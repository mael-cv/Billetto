import { Injectable, Logger } from '@nestjs/common';
import type { ActiviteDocument, ActivityType } from '../../common/mongodb/documents.types';
import { MongoService } from '../../common/mongodb/mongo.service';

/**
 * Journal d'activité (collection `activites`, append-only, TTL 90 jours).
 * L'écriture est « fire-and-forget » : une télémétrie ne doit jamais ralentir
 * ni faire échouer la requête métier (PostgreSQL reste la source de vérité).
 */
@Injectable()
export class ActivityLogger {
  private readonly logger = new Logger(ActivityLogger.name);

  constructor(private readonly mongo: MongoService) {}

  record(
    type: ActivityType,
    data: { utilisateurId?: number | null; evenementId?: number | null; payload?: Record<string, unknown> } = {},
  ): void {
    const doc: Omit<ActiviteDocument, '_id'> = {
      type,
      ts: new Date(),
      utilisateurId: data.utilisateurId ?? null,
      evenementId: data.evenementId ?? null,
      payload: data.payload ?? {},
    };
    this.mongo.activites.insertOne(doc).catch((err: Error) => {
      this.logger.warn(`activité ${type} non journalisée : ${err.message}`);
    });
  }

  /** Variante attendue (tests, écriture explicite via POST /activites). */
  async recordNow(type: ActivityType, data: Parameters<ActivityLogger['record']>[1] = {}): Promise<string> {
    const { insertedId } = await this.mongo.activites.insertOne({
      type,
      ts: new Date(),
      utilisateurId: data.utilisateurId ?? null,
      evenementId: data.evenementId ?? null,
      payload: data.payload ?? {},
    });
    return String(insertedId);
  }
}
