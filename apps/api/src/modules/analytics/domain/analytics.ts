import type { Tx } from '../../../common/database/db-context.service';
import type { Pagination } from '../../../common/validation/schemas';

export interface SalesSummary {
  evenements: number;
  evenementsAVenir: number;
  commandes: number;
  billetsVendus: number;
  chiffreAffaires: string;
  tauxRemplissageMoyen: number | null;
  source: 'vues' | 'vue_materialisee';
}

export interface EventSales {
  evenementId: number;
  nom: string;
  statut: string;
  debut: Date;
  billetsVendus: number;
  chiffreAffaires: string;
  places: number;
  tauxRemplissage: number | null;
}

export interface VenueRanking {
  lieuId: number;
  nom: string;
  ville: string;
  nbEvenements: number;
  billetsVendus: number;
  chiffreAffaires: string;
  rang: number;
  rangVille: number;
}

export interface DailySales {
  jour: string;
  commandes: number;
  billets: number;
  chiffreAffaires: string;
}

export interface RecentOrder {
  id: number;
  statut: string;
  montantTotal: string;
  createdAt: Date;
  billets: number;
}

export interface PriceAuditEntry {
  id: number;
  tarifId: number;
  tarif: string | null;
  evenement: string | null;
  action: 'UPDATE' | 'DELETE';
  ancienPrix: string | null;
  nouveauPrix: string | null;
  ancienQuota: number | null;
  nouveauQuota: number | null;
  auteur: string;
  createdAt: Date;
}

export const EVENT_SALES_SORTS = ['ca', 'billets', 'taux', 'date'] as const;
export type EventSalesSort = (typeof EVENT_SALES_SORTS)[number];

/** Dashboard temps réel : un événement publié à venir. */
export interface LiveEvent {
  evenementId: number;
  nom: string;
  debut: Date;
  places: number;
  vendus: number;
  /** Holds actifs non expirés, offres de liste d'attente comprises. */
  reserves: number;
  /** Places demandées par les inscrits encore en attente. */
  enAttente: number;
  tauxOccupation: number | null;
  chiffreAffaires: string;
}

export interface LiveDashboard {
  generatedAt: Date;
  totaux: { places: number; vendus: number; reserves: number; enAttente: number; chiffreAffaires: string };
  evenements: LiveEvent[];
}

export interface AnalyticsRepository {
  /** Organisateur : vues security_invoker filtrées par RLS. */
  summaryFromViews(tx: Tx): Promise<SalesSummary>;
  /** Admin : totaux depuis mv_ventes_quotidiennes (pré-calculés). */
  summaryFromMaterializedView(tx: Tx): Promise<SalesSummary>;
  eventSales(tx: Tx, sort: EventSalesSort, pagination: Pagination): Promise<{ items: EventSales[]; total: number }>;
  venueRanking(tx: Tx, pagination: Pagination): Promise<{ items: VenueRanking[]; total: number }>;
  dailySalesFromMaterializedView(tx: Tx, from: Date, to: Date): Promise<DailySales[]>;
  dailySalesFromTables(tx: Tx, from: Date, to: Date): Promise<DailySales[]>;
  recentOrders(tx: Tx, limit: number): Promise<RecentOrder[]>;
  /** Événements publiés à venir (v_remplissage, RLS) : vendu / réservé / en liste d'attente. */
  live(tx: Tx, limit: number): Promise<LiveEvent[]>;
  /** Rôle admin attendu (journal_tarifs). */
  priceAudit(tx: Tx, limit: number): Promise<PriceAuditEntry[]>;
}

export const ANALYTICS_REPOSITORY = Symbol('ANALYTICS_REPOSITORY');
