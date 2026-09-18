import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Tx } from '../../../common/database/db-context.service';
import { offsetOf } from '../../../common/pagination';
import { toMoney, toNullableMoney, toNumber } from '../../../common/serialization';
import type { Pagination } from '../../../common/validation/schemas';
import type {
  AnalyticsRepository,
  DailySales,
  EventSales,
  EventSalesSort,
  PriceAuditEntry,
  RecentOrder,
  SalesSummary,
  VenueRanking,
} from '../domain/analytics';

const SALES_ORDER: Record<EventSalesSort, Prisma.Sql> = {
  ca: Prisma.sql`v.ca DESC, v.evenement_id`,
  billets: Prisma.sql`v.billets_vendus DESC, v.evenement_id`,
  taux: Prisma.sql`taux_remplissage DESC NULLS LAST, v.evenement_id`,
  date: Prisma.sql`v.debut DESC, v.evenement_id`,
};

interface DailyRow {
  jour: Date;
  commandes: bigint;
  billets: bigint;
  ca: Prisma.Decimal | null;
}

const toDaily = (r: DailyRow): DailySales => ({
  jour: r.jour.toISOString().slice(0, 10),
  commandes: toNumber(r.commandes),
  billets: toNumber(r.billets),
  chiffreAffaires: toMoney(r.ca),
});

@Injectable()
export class PrismaAnalyticsRepository implements AnalyticsRepository {
  async summaryFromViews(tx: Tx): Promise<SalesSummary> {
    const rows = await tx.$queryRaw<
      {
        evenements: bigint;
        a_venir: bigint;
        commandes: bigint;
        billets: bigint | null;
        ca: Prisma.Decimal | null;
        taux: number | null;
      }[]
    >`
      SELECT count(*) AS evenements,
             (SELECT count(*) FROM commandes c WHERE c.statut = 'paid') AS commandes,
             count(*) FILTER (WHERE r.debut > now() AND r.statut = 'published') AS a_venir,
             sum(r.billets_vendus)::bigint AS billets,
             (SELECT sum(v.ca) FROM v_ventes_par_evenement v) AS ca,
             avg(r.taux_remplissage)::float8 AS taux
      FROM v_remplissage r`;
    const row = rows[0];
    return {
      evenements: toNumber(row?.evenements),
      evenementsAVenir: toNumber(row?.a_venir),
      commandes: toNumber(row?.commandes),
      billetsVendus: toNumber(row?.billets ?? 0n),
      chiffreAffaires: toMoney(row?.ca),
      tauxRemplissageMoyen: row?.taux ?? null,
      source: 'vues',
    };
  }

  async summaryFromMaterializedView(tx: Tx): Promise<SalesSummary> {
    const rows = await tx.$queryRaw<
      { evenements: bigint; a_venir: bigint; commandes: bigint | null; billets: bigint | null; ca: Prisma.Decimal | null }[]
    >`
      SELECT (SELECT count(*) FROM evenements) AS evenements,
             sum(commandes)::bigint AS commandes,
             (SELECT count(*) FROM evenements WHERE debut > now() AND statut = 'published') AS a_venir,
             sum(billets)::bigint AS billets,
             sum(ca) AS ca
      FROM mv_ventes_quotidiennes`;
    const row = rows[0];
    return {
      evenements: toNumber(row?.evenements),
      evenementsAVenir: toNumber(row?.a_venir),
      commandes: toNumber(row?.commandes ?? 0n),
      billetsVendus: toNumber(row?.billets ?? 0n),
      chiffreAffaires: toMoney(row?.ca),
      tauxRemplissageMoyen: null,
      source: 'vue_materialisee',
    };
  }

  async eventSales(tx: Tx, sort: EventSalesSort, pagination: Pagination) {
    // Une seule agrégation des billets (v_ventes_par_evenement) ; les places sont
    // calculées par événement via l'index uq_tarifs_evenement_id_nom.
    const [countRows, rows] = await Promise.all([
      tx.$queryRaw<{ total: bigint }[]>`SELECT count(*) AS total FROM evenements`,
      tx.$queryRaw<
        {
          evenement_id: bigint;
          nom: string;
          statut: string;
          debut: Date;
          billets_vendus: bigint;
          ca: Prisma.Decimal;
          places: bigint | null;
          taux_remplissage: number | null;
        }[]
      >`
        SELECT v.evenement_id, v.nom, v.statut, v.debut, v.billets_vendus, v.ca, p.places,
               (v.billets_vendus::numeric / nullif(p.places, 0))::float8 AS taux_remplissage
        FROM v_ventes_par_evenement v
        LEFT JOIN LATERAL (
          SELECT sum(t.quota) AS places FROM tarifs t WHERE t.evenement_id = v.evenement_id AND t.actif
        ) p ON TRUE
        ORDER BY ${SALES_ORDER[sort]}
        LIMIT ${pagination.pageSize} OFFSET ${offsetOf(pagination)}`,
    ]);
    const items: EventSales[] = rows.map((r) => ({
      evenementId: toNumber(r.evenement_id),
      nom: r.nom,
      statut: r.statut,
      debut: r.debut,
      billetsVendus: toNumber(r.billets_vendus),
      chiffreAffaires: toMoney(r.ca),
      places: toNumber(r.places ?? 0n),
      tauxRemplissage: r.taux_remplissage === null ? null : Math.round(r.taux_remplissage * 10_000) / 10_000,
    }));
    return { items, total: toNumber(countRows[0]?.total) };
  }

  async venueRanking(tx: Tx, pagination: Pagination) {
    const [countRows, rows] = await Promise.all([
      tx.$queryRaw<{ total: bigint }[]>`SELECT count(*) AS total FROM lieux`,
      tx.$queryRaw<
        {
          lieu_id: bigint;
          nom: string;
          ville: string;
          nb_evenements: bigint;
          billets_vendus: Prisma.Decimal;
          ca: Prisma.Decimal;
          rang: bigint;
          rang_ville: bigint;
        }[]
      >`
        SELECT lieu_id, nom, ville, nb_evenements, billets_vendus, ca, rang, rang_ville
        FROM v_classement_lieux
        ORDER BY rang, lieu_id
        LIMIT ${pagination.pageSize} OFFSET ${offsetOf(pagination)}`,
    ]);
    const items: VenueRanking[] = rows.map((r) => ({
      lieuId: toNumber(r.lieu_id),
      nom: r.nom,
      ville: r.ville,
      nbEvenements: toNumber(r.nb_evenements),
      billetsVendus: Number(r.billets_vendus),
      chiffreAffaires: toMoney(r.ca),
      rang: toNumber(r.rang),
      rangVille: toNumber(r.rang_ville),
    }));
    return { items, total: toNumber(countRows[0]?.total) };
  }

  async dailySalesFromMaterializedView(tx: Tx, from: Date, to: Date): Promise<DailySales[]> {
    const rows = await tx.$queryRaw<DailyRow[]>`
      SELECT jour, commandes, billets, ca
      FROM mv_ventes_quotidiennes
      WHERE jour >= ${from}::date AND jour < ${to}::date
      ORDER BY jour`;
    return rows.map(toDaily);
  }

  async dailySalesFromTables(tx: Tx, from: Date, to: Date): Promise<DailySales[]> {
    // Même définition que la vue matérialisée, calculée à la volée sous RLS
    // (la MV ne peut pas être filtrée par organisateur).
    const rows = await tx.$queryRaw<DailyRow[]>`
      SELECT (c.created_at AT TIME ZONE 'Europe/Paris')::date AS jour,
             count(DISTINCT c.id) AS commandes,
             count(*) AS billets,
             sum(b.prix_paye) AS ca
      FROM billets b
      JOIN commandes c ON c.id = b.commande_id AND c.statut = 'paid'
      WHERE c.created_at >= ${from} AND c.created_at < ${to}
      GROUP BY 1
      ORDER BY 1`;
    return rows.map(toDaily);
  }

  async priceAudit(tx: Tx, limit: number): Promise<PriceAuditEntry[]> {
    // auteur = app.user_id (identifiant) ou rôle de connexion : jointure pour afficher l'e-mail.
    const rows = await tx.$queryRaw<
      {
        id: bigint;
        tarif_id: bigint;
        tarif: string | null;
        evenement: string | null;
        action: 'UPDATE' | 'DELETE';
        ancien_prix: Prisma.Decimal | null;
        nouveau_prix: Prisma.Decimal | null;
        ancien_quota: number | null;
        nouveau_quota: number | null;
        auteur: string;
        created_at: Date;
      }[]
    >`
      SELECT j.id, j.tarif_id, t.nom AS tarif, e.nom AS evenement, j.action,
             j.ancien_prix, j.nouveau_prix, j.ancien_quota, j.nouveau_quota,
             coalesce(u.email, j.auteur) AS auteur, j.created_at
      FROM journal_tarifs j
      LEFT JOIN tarifs t       ON t.id = j.tarif_id
      LEFT JOIN evenements e   ON e.id = t.evenement_id
      -- Comparaison en texte : SQL ne garantit pas l'ordre d'évaluation d'un AND,
      -- un cast j.auteur::bigint échouerait sur un auteur « billetto_owner » (22P02).
      LEFT JOIN utilisateurs u ON u.id::text = j.auteur
      ORDER BY j.created_at DESC, j.id DESC
      LIMIT ${limit}`;
    return rows.map((r) => ({
      id: toNumber(r.id),
      tarifId: toNumber(r.tarif_id),
      tarif: r.tarif,
      evenement: r.evenement,
      action: r.action,
      ancienPrix: toNullableMoney(r.ancien_prix),
      nouveauPrix: toNullableMoney(r.nouveau_prix),
      ancienQuota: r.ancien_quota,
      nouveauQuota: r.nouveau_quota,
      auteur: r.auteur,
      createdAt: r.created_at,
    }));
  }

  async recentOrders(tx: Tx, limit: number): Promise<RecentOrder[]> {
    const rows = await tx.$queryRaw<
      { id: bigint; statut: string; montant_total: Prisma.Decimal; created_at: Date; billets: bigint }[]
    >`
      SELECT c.id, c.statut, c.montant_total, c.created_at,
             (SELECT count(*) FROM billets b WHERE b.commande_id = c.id) AS billets
      FROM commandes c
      ORDER BY c.created_at DESC, c.id DESC
      LIMIT ${limit}`;
    return rows.map((r) => ({
      id: toNumber(r.id),
      statut: r.statut,
      montantTotal: toMoney(r.montant_total),
      createdAt: r.created_at,
      billets: toNumber(r.billets),
    }));
  }
}
