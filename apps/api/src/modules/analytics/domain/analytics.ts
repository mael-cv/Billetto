import type { Tx } from '../../../common/database/db-context.service';
import type { Pagination } from '../../../common/validation/schemas';

export interface SalesSummary {
  evenements: number;
  evenementsAVenir: number;
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

export const EVENT_SALES_SORTS = ['ca', 'billets', 'taux', 'date'] as const;
export type EventSalesSort = (typeof EVENT_SALES_SORTS)[number];

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
}

export const ANALYTICS_REPOSITORY = Symbol('ANALYTICS_REPOSITORY');
