import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { type Filter, ObjectId } from 'mongodb';
import type { Actor } from '../../../auth/domain/actor';
import { toDbActor } from '../../../auth/domain/to-db-actor';
import { ANONYMOUS, DbContextService } from '../../../common/database/db-context.service';
import { ApiError, forbidden, notFound } from '../../../common/errors/http-errors';
import type { AvisDocument } from '../../../common/mongodb/documents.types';
import { MongoService } from '../../../common/mongodb/mongo.service';
import { type Page, offsetOf, toPage } from '../../../common/pagination';
import type { Pagination } from '../../../common/validation/schemas';
import { EVENTS_REPOSITORY, type EventsRepository } from '../../events/domain/events.repository';
import type { CreateReviewDto, UpdateReviewDto } from '../presentation/reviews.dto';

export interface ReviewView {
  id: string;
  evenementId: number;
  utilisateurId: number;
  prenom: string;
  note: number;
  titre?: string;
  commentaire: string;
  utile: number;
  reponseOrganisateur?: { texte: string; date: Date };
  createdAt: Date;
  updatedAt?: Date;
}

export interface ReviewStats {
  nbAvis: number;
  moyenne: number | null;
  distribution: Record<'1' | '2' | '3' | '4' | '5', number>;
  tauxReponse: number;
}

export interface ReviewListResult extends Page<ReviewView> {
  stats: ReviewStats;
}

export const toReviewView = (doc: AvisDocument): ReviewView => ({
  id: String(doc._id),
  evenementId: doc.evenementId,
  utilisateurId: doc.utilisateurId,
  prenom: doc.utilisateur.prenom,
  note: doc.note,
  ...(doc.titre !== undefined ? { titre: doc.titre } : {}),
  commentaire: doc.commentaire,
  utile: doc.utile,
  ...(doc.reponseOrganisateur ? { reponseOrganisateur: doc.reponseOrganisateur } : {}),
  createdAt: doc.createdAt,
  ...(doc.updatedAt ? { updatedAt: doc.updatedAt } : {}),
});

interface StatsRow {
  nbAvis: number;
  moyenne: number | null;
  avecReponse: number;
  notes: number[];
}

/** Pipeline d'agrégation : moyenne, distribution 1..5 et taux de réponse d'un événement. */
export async function computeStats(mongo: MongoService, evenementId: number): Promise<ReviewStats> {
  const [row] = await mongo.avis
    .aggregate<StatsRow>([
      { $match: { evenementId } },
      {
        $group: {
          _id: null,
          nbAvis: { $sum: 1 },
          moyenne: { $avg: '$note' },
          avecReponse: { $sum: { $cond: [{ $ifNull: ['$reponseOrganisateur', false] }, 1, 0] } },
          notes: { $push: '$note' },
        },
      },
    ])
    .toArray();
  const distribution: ReviewStats['distribution'] = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
  if (!row) return { nbAvis: 0, moyenne: null, distribution, tauxReponse: 0 };
  for (const n of row.notes) {
    const key = String(n) as keyof ReviewStats['distribution'];
    if (key in distribution) distribution[key] += 1;
  }
  return {
    nbAvis: row.nbAvis,
    moyenne: row.moyenne === null ? null : Math.round(row.moyenne * 100) / 100,
    distribution,
    tauxReponse: row.nbAvis ? Math.round((row.avecReponse / row.nbAvis) * 100) / 100 : 0,
  };
}

/** Lecture publique : l'événement doit être visible (RLS PostgreSQL) ; avis et stats depuis MongoDB. */
@Injectable()
export class ListReviewsUseCase {
  constructor(
    private readonly db: DbContextService,
    @Inject(EVENTS_REPOSITORY) private readonly events: EventsRepository,
    private readonly mongo: MongoService,
  ) {}

  async execute(
    ref: { id: number } | { slug: string },
    filters: { noteMin?: number; sansReponse?: boolean },
    pagination: Pagination,
  ): Promise<ReviewListResult> {
    const evenement = await this.db.run(ANONYMOUS, (tx) => this.events.findByRef(tx, ref));
    if (!evenement) throw notFound('Événement');

    const filter: Filter<AvisDocument> = { evenementId: evenement.id };
    if (filters.noteMin !== undefined) filter.note = { $gte: filters.noteMin };
    if (filters.sansReponse) filter.reponseOrganisateur = { $exists: false };

    const [items, total, stats] = await Promise.all([
      this.mongo.avis.find(filter).sort({ createdAt: -1 }).skip(offsetOf(pagination)).limit(pagination.pageSize).toArray(),
      this.mongo.avis.countDocuments(filter),
      computeStats(this.mongo, evenement.id),
    ]);
    return { ...toPage(items.map(toReviewView), total, pagination), stats };
  }
}

/**
 * Écriture croisée : un avis n'est accepté que si PostgreSQL confirme un billet
 * payé de cet acheteur pour cet événement (requête sous le rôle acheteur : la RLS
 * ne lui montre que ses propres billets). L'index unique MongoDB garantit un seul
 * avis par acheteur et par événement (409 DOUBLON sinon).
 */
@Injectable()
export class CreateReviewUseCase {
  constructor(
    private readonly db: DbContextService,
    private readonly mongo: MongoService,
  ) {}

  async execute(actor: Actor, evenementId: number, input: CreateReviewDto): Promise<ReviewView> {
    const rows = await this.db.asBuyer(actor.userId, (tx) =>
      tx.$queryRaw<{ ok: boolean }[]>`
        SELECT EXISTS (
          SELECT 1
          FROM billets b
          JOIN commandes c ON c.id = b.commande_id AND c.statut = 'paid'
          JOIN tarifs t    ON t.id = b.tarif_id
          WHERE b.utilisateur_id = ${actor.userId} AND t.evenement_id = ${evenementId}
        ) AS ok`,
    );
    if (!rows[0]?.ok) {
      throw new ApiError(HttpStatus.FORBIDDEN, 'BILLET_REQUIS', 'Un billet payé pour cet événement est nécessaire pour laisser un avis');
    }
    const doc: Omit<AvisDocument, '_id'> = {
      evenementId,
      utilisateurId: actor.userId,
      utilisateur: { prenom: actor.prenom },
      note: input.note,
      ...(input.titre ? { titre: input.titre } : {}),
      commentaire: input.commentaire,
      utile: 0,
      createdAt: new Date(),
    };
    const { insertedId } = await this.mongo.avis.insertOne(doc);
    return toReviewView({ ...doc, _id: insertedId });
  }
}

@Injectable()
export class UpdateReviewUseCase {
  constructor(private readonly mongo: MongoService) {}

  async execute(actor: Actor, id: string, input: UpdateReviewDto): Promise<ReviewView> {
    const _id = new ObjectId(id);
    const existing = await this.mongo.avis.findOne({ _id });
    if (!existing) throw notFound('Avis');
    if (existing.utilisateurId !== actor.userId) throw forbidden();
    const updated = await this.mongo.avis.findOneAndUpdate(
      { _id },
      { $set: { ...input, updatedAt: new Date() } },
      { returnDocument: 'after' },
    );
    if (!updated) throw notFound('Avis');
    return toReviewView(updated);
  }
}

@Injectable()
export class DeleteReviewUseCase {
  constructor(private readonly mongo: MongoService) {}

  async execute(actor: Actor, id: string): Promise<void> {
    const _id = new ObjectId(id);
    const existing = await this.mongo.avis.findOne({ _id });
    if (!existing) throw notFound('Avis');
    if (existing.utilisateurId !== actor.userId && actor.role !== 'admin') throw forbidden();
    await this.mongo.avis.deleteOne({ _id });
  }
}

/** Réponse de l'organisateur : champ imbriqué ($set) ; propriété vérifiée côté PostgreSQL (RLS manage). */
@Injectable()
export class ReplyReviewUseCase {
  constructor(
    private readonly db: DbContextService,
    @Inject(EVENTS_REPOSITORY) private readonly events: EventsRepository,
    private readonly mongo: MongoService,
  ) {}

  async execute(actor: Actor, id: string, texte: string): Promise<ReviewView> {
    const _id = new ObjectId(id);
    const existing = await this.mongo.avis.findOne({ _id });
    if (!existing) throw notFound('Avis');
    const evenement = await this.db.run(toDbActor(actor), (tx) => this.events.findByRef(tx, { id: existing.evenementId }));
    if (!evenement) throw forbidden('Vous ne gérez pas cet événement');
    const updated = await this.mongo.avis.findOneAndUpdate(
      { _id },
      { $set: { reponseOrganisateur: { texte, date: new Date() }, updatedAt: new Date() } },
      { returnDocument: 'after' },
    );
    if (!updated) throw notFound('Avis');
    return toReviewView(updated);
  }
}

/** Avis reçus par un organisateur : identifiants d'événements depuis PostgreSQL (RLS), documents depuis MongoDB. */
@Injectable()
export class ListOrganizerReviewsUseCase {
  constructor(
    private readonly db: DbContextService,
    private readonly mongo: MongoService,
  ) {}

  async execute(actor: Actor, filters: { sansReponse?: boolean }, pagination: Pagination): Promise<Page<ReviewView & { evenement: string }>> {
    const evenements = await this.db.run(toDbActor(actor), (tx) =>
      tx.$queryRaw<{ id: bigint; nom: string }[]>`SELECT id, nom FROM evenements`,
    );
    const noms = new Map(evenements.map((e) => [Number(e.id), e.nom]));
    const filter: Filter<AvisDocument> = { evenementId: { $in: [...noms.keys()] } };
    if (filters.sansReponse) filter.reponseOrganisateur = { $exists: false };
    const [items, total] = await Promise.all([
      this.mongo.avis.find(filter).sort({ createdAt: -1 }).skip(offsetOf(pagination)).limit(pagination.pageSize).toArray(),
      this.mongo.avis.countDocuments(filter),
    ]);
    return toPage(
      items.map((doc) => ({ ...toReviewView(doc), evenement: noms.get(doc.evenementId) ?? '' })),
      total,
      pagination,
    );
  }
}
