import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Tx } from '../../../common/database/db-context.service';
import { offsetOf } from '../../../common/pagination';
import { escapeLike, toMoney, toNullableMoney, toNumber } from '../../../common/serialization';
import type { Pagination } from '../../../common/validation/schemas';
import type { EventDetail, EventFilters, EventInput, EventSort, EventStatus, EventSummary } from '../domain/event';
import type { EventsRepository } from '../domain/events.repository';

interface SummaryRow {
  id: bigint;
  slug: string;
  nom: string;
  statut: EventStatus;
  debut: Date;
  fin: Date;
  lieu_id: bigint;
  lieu: string;
  ville: string;
  type_id: bigint;
  type: string;
  organisateur: string;
  prix_min: Prisma.Decimal | null;
}

interface DetailRow extends Omit<SummaryRow, 'prix_min'> {
  description: string;
  organisateur_id: bigint;
  adresse: string;
  code_postal: string;
  capacite: number;
}

interface PriceRow {
  id: bigint;
  nom: string;
  prix: Prisma.Decimal;
  quota: number;
  restantes: number;
  date_debut_vente: Date;
  date_fin_vente: Date;
  actif: boolean;
}

// Tris autorisés : jamais de fragment SQL issu de la requête HTTP.
const ORDER_BY: Record<EventSort, Prisma.Sql> = {
  date: Prisma.sql`e.debut ASC, e.id ASC`,
  '-date': Prisma.sql`e.debut DESC, e.id DESC`,
  prix: Prisma.sql`prix.prix_min ASC NULLS LAST, e.debut ASC, e.id ASC`,
  nom: Prisma.sql`e.nom ASC, e.id ASC`,
};

@Injectable()
export class PrismaEventsRepository implements EventsRepository {
  async list(tx: Tx, filters: EventFilters, pagination: Pagination) {
    const conditions: Prisma.Sql[] = [Prisma.sql`TRUE`];
    if (filters.q) {
      const pattern = `%${escapeLike(filters.q)}%`;
      conditions.push(Prisma.sql`(e.nom ILIKE ${pattern} OR l.ville ILIKE ${pattern} OR te.nom ILIKE ${pattern})`);
    }
    if (filters.ville) conditions.push(Prisma.sql`l.ville = ${filters.ville}`);
    if (filters.typeId !== undefined) {
      // Le filtre par type inclut tous ses sous-types (WITH RECURSIVE).
      conditions.push(Prisma.sql`e.type_evenement_id IN (
        WITH RECURSIVE sous_types AS (
          SELECT id FROM type_evenements WHERE id = ${filters.typeId}
          UNION ALL
          SELECT t.id FROM type_evenements t JOIN sous_types s ON t.parent_id = s.id
        )
        SELECT id FROM sous_types)`);
    }
    if (filters.from) conditions.push(Prisma.sql`e.debut >= ${filters.from}`);
    if (filters.to) conditions.push(Prisma.sql`e.debut < ${filters.to}`);
    if (filters.statut) conditions.push(Prisma.sql`e.statut = ${filters.statut}`);
    if (filters.prixMax !== undefined) conditions.push(Prisma.sql`prix.prix_min <= ${filters.prixMax}::numeric`);

    const from = Prisma.sql`
      FROM evenements e
      JOIN lieux l            ON l.id = e.lieu_id
      JOIN type_evenements te ON te.id = e.type_evenement_id
      JOIN organisateurs o    ON o.id = e.organisateur_id
      LEFT JOIN LATERAL (
        SELECT min(tr.prix) AS prix_min FROM tarifs tr WHERE tr.evenement_id = e.id AND tr.actif
      ) prix ON TRUE
      WHERE ${Prisma.join(conditions, ' AND ')}`;

    const [countRows, rows] = await Promise.all([
      tx.$queryRaw<{ total: bigint }[]>`SELECT count(*) AS total ${from}`,
      tx.$queryRaw<SummaryRow[]>`
        SELECT e.id, e.slug, e.nom, e.statut, e.debut, e.fin,
               l.id AS lieu_id, l.nom AS lieu, l.ville,
               te.id AS type_id, te.nom AS type,
               o.nom AS organisateur, prix.prix_min
        ${from}
        ORDER BY ${ORDER_BY[filters.sort]}
        LIMIT ${pagination.pageSize} OFFSET ${offsetOf(pagination)}`,
    ]);

    return { items: rows.map(toSummary), total: toNumber(countRows[0]?.total) };
  }

  async findByRef(tx: Tx, ref: { id: number } | { slug: string }): Promise<EventDetail | null> {
    const where = 'id' in ref ? Prisma.sql`e.id = ${ref.id}` : Prisma.sql`e.slug = ${ref.slug}`;
    const rows = await tx.$queryRaw<DetailRow[]>`
      SELECT e.id, e.slug, e.nom, e.description, e.statut, e.debut, e.fin, e.organisateur_id,
             o.nom AS organisateur,
             l.id AS lieu_id, l.nom AS lieu, l.adresse, l.ville, l.code_postal, l.capacite,
             te.id AS type_id, te.nom AS type
      FROM evenements e
      JOIN lieux l            ON l.id = e.lieu_id
      JOIN type_evenements te ON te.id = e.type_evenement_id
      JOIN organisateurs o    ON o.id = e.organisateur_id
      WHERE ${where}`;
    const row = rows[0];
    if (!row) return null;

    const [attributs, tarifs] = await Promise.all([
      tx.$queryRaw<{ cle: string; valeur: string }[]>`
        SELECT cle, valeur FROM evenement_attributs WHERE evenement_id = ${row.id} ORDER BY cle`,
      tx.$queryRaw<PriceRow[]>`
        SELECT t.id, t.nom, t.prix, t.quota, places_restantes(t.id) AS restantes,
               t.date_debut_vente, t.date_fin_vente, t.actif
        FROM tarifs t
        WHERE t.evenement_id = ${row.id}
        ORDER BY t.prix, t.id`,
    ]);

    return {
      id: toNumber(row.id),
      slug: row.slug,
      nom: row.nom,
      description: row.description,
      statut: row.statut,
      debut: row.debut,
      fin: row.fin,
      organisateurId: toNumber(row.organisateur_id),
      organisateur: row.organisateur,
      lieu: {
        id: toNumber(row.lieu_id),
        nom: row.lieu,
        adresse: row.adresse,
        ville: row.ville,
        codePostal: row.code_postal,
        capacite: row.capacite,
      },
      type: { id: toNumber(row.type_id), nom: row.type },
      attributs,
      tarifs: tarifs.map((t) => ({
        id: toNumber(t.id),
        nom: t.nom,
        prix: toMoney(t.prix),
        quota: t.quota,
        restantes: t.restantes,
        dateDebutVente: t.date_debut_vente,
        dateFinVente: t.date_fin_vente,
        actif: t.actif,
      })),
    };
  }

  async create(tx: Tx, organisateurId: number, input: EventInput): Promise<number> {
    const created = await tx.evenements.create({
      data: {
        organisateur_id: BigInt(organisateurId),
        lieu_id: BigInt(input.lieuId),
        type_evenement_id: BigInt(input.typeEvenementId),
        nom: input.nom,
        slug: input.slug,
        description: input.description,
        debut: input.debut,
        fin: input.fin,
        statut: input.statut,
      },
      select: { id: true },
    });
    return toNumber(created.id);
  }

  async update(tx: Tx, id: number, input: Partial<EventInput>): Promise<number> {
    const result = await tx.evenements.updateMany({
      where: { id: BigInt(id) },
      data: {
        ...(input.nom !== undefined && { nom: input.nom }),
        ...(input.slug !== undefined && { slug: input.slug }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.debut !== undefined && { debut: input.debut }),
        ...(input.fin !== undefined && { fin: input.fin }),
        ...(input.statut !== undefined && { statut: input.statut }),
        ...(input.lieuId !== undefined && { lieu_id: BigInt(input.lieuId) }),
        ...(input.typeEvenementId !== undefined && { type_evenement_id: BigInt(input.typeEvenementId) }),
      },
    });
    return result.count;
  }

  async replaceAttributes(tx: Tx, id: number, attributes: { cle: string; valeur: string }[]): Promise<void> {
    await tx.evenement_attributs.deleteMany({ where: { evenement_id: BigInt(id) } });
    if (attributes.length > 0) {
      await tx.evenement_attributs.createMany({
        data: attributes.map((a) => ({ evenement_id: BigInt(id), cle: a.cle, valeur: a.valeur })),
      });
    }
  }

  async delete(tx: Tx, id: number): Promise<number> {
    const result = await tx.evenements.deleteMany({ where: { id: BigInt(id) } });
    return result.count;
  }
}

function toSummary(row: SummaryRow): EventSummary {
  return {
    id: toNumber(row.id),
    slug: row.slug,
    nom: row.nom,
    statut: row.statut,
    debut: row.debut,
    fin: row.fin,
    lieu: { id: toNumber(row.lieu_id), nom: row.lieu, ville: row.ville },
    type: { id: toNumber(row.type_id), nom: row.type },
    organisateur: row.organisateur,
    prixMin: toNullableMoney(row.prix_min),
  };
}
