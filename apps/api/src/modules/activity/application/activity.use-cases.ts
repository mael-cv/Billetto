import { Inject, Injectable } from '@nestjs/common';
import type { Actor } from '../../../auth/domain/actor';
import { toDbActor } from '../../../auth/domain/to-db-actor';
import { ANONYMOUS, DbContextService } from '../../../common/database/db-context.service';
import { notFound } from '../../../common/errors/http-errors';
import type { ActivityType } from '../../../common/mongodb/documents.types';
import { MongoService } from '../../../common/mongodb/mongo.service';
import type { EventSummary } from '../../events/domain/event';
import { EVENTS_REPOSITORY, type EventsRepository } from '../../events/domain/events.repository';

export interface TrendingScore {
  evenementId: number;
  score: number;
  vues: number;
  achats: number;
  scans: number;
  visiteursDistincts: number;
}

export interface TrendingItem extends TrendingScore {
  evenement: EventSummary;
}

/**
 * Événements tendance : pipeline d'agrégation MongoDB (score pondéré des
 * activités récentes) puis croisement avec PostgreSQL, qui ne renvoie que les
 * événements visibles du catalogue public (RLS) — un brouillon ou un événement
 * annulé disparaît du classement même s'il a du trafic.
 */
@Injectable()
export class TrendingEventsUseCase {
  constructor(
    private readonly db: DbContextService,
    @Inject(EVENTS_REPOSITORY) private readonly events: EventsRepository,
    private readonly mongo: MongoService,
  ) {}

  async execute(jours: number, limit: number): Promise<TrendingItem[]> {
    const depuis = new Date(Date.now() - jours * 86_400_000);
    const scores = await this.mongo.activites
      .aggregate<TrendingScore>([
        { $match: { ts: { $gte: depuis }, evenementId: { $ne: null } } },
        {
          $group: {
            _id: '$evenementId',
            vues: { $sum: { $cond: [{ $eq: ['$type', 'vue_evenement'] }, 1, 0] } },
            achats: { $sum: { $cond: [{ $eq: ['$type', 'achat'] }, 1, 0] } },
            scans: { $sum: { $cond: [{ $eq: ['$type', 'scan_checkin'] }, 1, 0] } },
            visiteurs: { $addToSet: '$utilisateurId' },
          },
        },
        {
          $project: {
            _id: 0,
            evenementId: '$_id',
            vues: 1,
            achats: 1,
            scans: 1,
            visiteursDistincts: { $size: { $setDifference: ['$visiteurs', [null]] } },
            score: { $add: ['$vues', { $multiply: ['$achats', 5] }, { $multiply: ['$scans', 2] }] },
          },
        },
        { $sort: { score: -1, evenementId: 1 } },
        // Marge : certains événements seront filtrés par PostgreSQL (non publiés).
        { $limit: limit * 3 },
      ])
      .toArray();
    if (scores.length === 0) return [];

    const summaries = await this.db.run(ANONYMOUS, (tx) =>
      this.events.findSummariesByIds(
        tx,
        scores.map((s) => s.evenementId),
      ),
    );
    const parId = new Map(summaries.map((s) => [s.id, s]));
    return scores
      .filter((s) => parId.has(s.evenementId))
      .slice(0, limit)
      .map((s) => ({ ...s, evenement: parId.get(s.evenementId) as EventSummary }));
  }
}

export interface ActivityBucket {
  periode: Date;
  total: number;
  parType: Partial<Record<ActivityType, number>>;
}

/** Série temporelle d'un événement ($dateTrunc) pour son organisateur (propriété vérifiée par la RLS). */
@Injectable()
export class EventActivitySeriesUseCase {
  constructor(
    private readonly db: DbContextService,
    @Inject(EVENTS_REPOSITORY) private readonly events: EventsRepository,
    private readonly mongo: MongoService,
  ) {}

  async execute(actor: Actor, evenementId: number, granularite: 'hour' | 'day', jours: number): Promise<ActivityBucket[]> {
    const evenement = await this.db.run(toDbActor(actor), (tx) => this.events.findByRef(tx, { id: evenementId }));
    if (!evenement) throw notFound('Événement');
    const depuis = new Date(Date.now() - jours * 86_400_000);
    return this.mongo.activites
      .aggregate<ActivityBucket>([
        { $match: { evenementId, ts: { $gte: depuis } } },
        { $group: { _id: { periode: { $dateTrunc: { date: '$ts', unit: granularite } }, type: '$type' }, n: { $sum: 1 } } },
        { $group: { _id: '$_id.periode', parType: { $push: { k: '$_id.type', v: '$n' } }, total: { $sum: '$n' } } },
        { $project: { _id: 0, periode: '$_id', total: 1, parType: { $arrayToObject: '$parType' } } },
        { $sort: { periode: 1 } },
      ])
      .toArray();
  }
}

/** Purge manuelle (admin) en complément de l'index TTL. */
@Injectable()
export class PurgeActivityUseCase {
  constructor(private readonly mongo: MongoService) {}

  async execute(avant: Date): Promise<{ supprimees: number }> {
    const { deletedCount } = await this.mongo.activites.deleteMany({ ts: { $lt: avant } });
    return { supprimees: deletedCount };
  }
}
