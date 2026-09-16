import { Inject, Injectable } from '@nestjs/common';
import type { Actor } from '../../../auth/domain/actor';
import { DbContextService } from '../../../common/database/db-context.service';
import { notFound } from '../../../common/errors/http-errors';
import { type Page, toPage } from '../../../common/pagination';
import type { Pagination } from '../../../common/validation/schemas';
import { type OrderDetail, ORDERS_REPOSITORY, type OrderSummary, type OrdersRepository } from '../domain/order';

@Injectable()
export class ListMyOrdersUseCase {
  constructor(
    private readonly db: DbContextService,
    @Inject(ORDERS_REPOSITORY) private readonly orders: OrdersRepository,
  ) {}

  async execute(actor: Actor, pagination: Pagination): Promise<Page<OrderSummary>> {
    const { items, total } = await this.db.asBuyer(actor.userId, (tx) =>
      this.orders.listForBuyer(tx, actor.userId, pagination),
    );
    return toPage(items, total, pagination);
  }
}

@Injectable()
export class GetOrderUseCase {
  constructor(
    private readonly db: DbContextService,
    @Inject(ORDERS_REPOSITORY) private readonly orders: OrdersRepository,
  ) {}

  /** Admin : toute commande. Autres : uniquement les siennes (sinon 404, sans révéler l'existence). */
  async execute(actor: Actor, orderId: number): Promise<OrderDetail> {
    const order =
      actor.role === 'admin'
        ? await this.db.run({ userId: actor.userId, role: 'admin' }, (tx) => this.orders.findAny(tx, orderId))
        : await this.db.asBuyer(actor.userId, (tx) => this.orders.findForBuyer(tx, actor.userId, orderId));
    if (!order) throw notFound('Commande');
    return order;
  }
}

@Injectable()
export class RefundOrderUseCase {
  constructor(
    private readonly db: DbContextService,
    @Inject(ORDERS_REPOSITORY) private readonly orders: OrdersRepository,
  ) {}

  /**
   * Admin : admin_rembourser_commande (EXECUTE réservé au rôle admin).
   * Autres : rembourser_commande, qui refuse (BT013) une commande d'autrui.
   * Les règles (statut, date de l'événement) sont dans PostgreSQL.
   */
  async execute(actor: Actor, orderId: number): Promise<OrderDetail> {
    if (actor.role === 'admin') {
      return this.db.run({ userId: actor.userId, role: 'admin' }, async (tx) => {
        if (!(await this.orders.findAny(tx, orderId))) throw notFound('Commande');
        await this.orders.refundAsAdmin(tx, orderId);
        const order = await this.orders.findAny(tx, orderId);
        if (!order) throw notFound('Commande');
        return order;
      });
    }
    return this.db.asBuyer(actor.userId, async (tx) => {
      // Vérification préalable : une commande d'autrui répond 404, pas 403.
      if (!(await this.orders.findForBuyer(tx, actor.userId, orderId))) throw notFound('Commande');
      await this.orders.refundAsOwner(tx, orderId);
      const order = await this.orders.findForBuyer(tx, actor.userId, orderId);
      if (!order) throw notFound('Commande');
      return order;
    });
  }
}
