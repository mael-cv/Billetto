import { Inject, Injectable } from '@nestjs/common';
import type { Actor } from '../../../auth/domain/actor';
import { toDbActor } from '../../../auth/domain/to-db-actor';
import { DbContextService } from '../../../common/database/db-context.service';
import { type Page, toPage } from '../../../common/pagination';
import type { Pagination } from '../../../common/validation/schemas';
import {
  ANALYTICS_REPOSITORY,
  type AnalyticsRepository,
  type DailySales,
  type EventSales,
  type EventSalesSort,
  type LiveDashboard,
  type PriceAuditEntry,
  type RecentOrder,
  type SalesSummary,
  type VenueRanking,
} from '../domain/analytics';

const LIVE_LIMIT = 50;

/**
 * Les mêmes endpoints servent organisateurs et administrateurs : la RLS et les
 * vues security_invoker restreignent les chiffres de l'organisateur à ses
 * événements. Aucun filtre organisateur n'est écrit en TypeScript.
 */
@Injectable()
export class AnalyticsUseCases {
  constructor(
    private readonly db: DbContextService,
    @Inject(ANALYTICS_REPOSITORY) private readonly analytics: AnalyticsRepository,
  ) {}

  summary(actor: Actor): Promise<SalesSummary> {
    return this.db.run(toDbActor(actor), (tx) =>
      actor.role === 'admin' ? this.analytics.summaryFromMaterializedView(tx) : this.analytics.summaryFromViews(tx),
    );
  }

  async eventSales(actor: Actor, sort: EventSalesSort, pagination: Pagination): Promise<Page<EventSales>> {
    const { items, total } = await this.db.run(toDbActor(actor), (tx) =>
      this.analytics.eventSales(tx, sort, pagination),
    );
    return toPage(items, total, pagination);
  }

  async venueRanking(actor: Actor, pagination: Pagination): Promise<Page<VenueRanking>> {
    const { items, total } = await this.db.run(toDbActor(actor), (tx) => this.analytics.venueRanking(tx, pagination));
    return toPage(items, total, pagination);
  }

  /** Admin : vue matérialisée (rapide, fraîcheur = dernier REFRESH). Organisateur : calcul à la volée sous RLS. */
  dailySales(actor: Actor, from: Date, to: Date): Promise<DailySales[]> {
    return this.db.run(toDbActor(actor), (tx) =>
      actor.role === 'admin'
        ? this.analytics.dailySalesFromMaterializedView(tx, from, to)
        : this.analytics.dailySalesFromTables(tx, from, to),
    );
  }

  /**
   * Dashboard temps réel (polling court) : lecture directe des vues, jamais de
   * la vue matérialisée, pour refléter les ventes et holds de la seconde.
   * Les totaux sont calculés sur les mêmes lignes que le détail.
   */
  async live(actor: Actor): Promise<LiveDashboard> {
    const evenements = await this.db.run(toDbActor(actor), (tx) => this.analytics.live(tx, LIVE_LIMIT));
    const sum = (pick: (e: (typeof evenements)[number]) => number) => evenements.reduce((n, e) => n + pick(e), 0);
    return {
      generatedAt: new Date(),
      totaux: {
        places: sum((e) => e.places),
        vendus: sum((e) => e.vendus),
        reserves: sum((e) => e.reserves),
        enAttente: sum((e) => e.enAttente),
        chiffreAffaires: sum((e) => Number(e.chiffreAffaires)).toFixed(2),
      },
      evenements,
    };
  }

  priceAudit(actor: Actor, limit: number): Promise<PriceAuditEntry[]> {
    return this.db.run(toDbActor(actor), (tx) => this.analytics.priceAudit(tx, limit));
  }

  recentOrders(actor: Actor, limit: number): Promise<RecentOrder[]> {
    return this.db.run(toDbActor(actor), (tx) => this.analytics.recentOrders(tx, limit));
  }
}
