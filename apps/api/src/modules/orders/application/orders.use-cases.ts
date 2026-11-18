import { Inject, Injectable } from '@nestjs/common';
import type { Actor } from '../../../auth/domain/actor';
import { APP_CONFIG, type AppConfig } from '../../../common/config/config';
import { DbContextService } from '../../../common/database/db-context.service';
import { notFound } from '../../../common/errors/http-errors';
import { type Page, toPage } from '../../../common/pagination';
import type { Pagination } from '../../../common/validation/schemas';
import { ActivityLogger } from '../../activity/activity-logger.service';
import { PAYMENT_GATEWAY, type PaymentGateway } from '../../payments/domain/payment-gateway';
import {
  type CheckoutResult,
  type ConfirmResult,
  type HoldView,
  type ModePaiement,
  type OrderDetail,
  ORDERS_REPOSITORY,
  type OrderSummary,
  type OrdersRepository,
  type PendingTransfer,
  type Reservation,
} from '../domain/order';

/** Durée de la session de paiement (minimum accepté par Stripe : 30 minutes). */
const CHECKOUT_SESSION_SECONDS = 31 * 60;

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

@Injectable()
export class HoldOrderUseCase {
  constructor(
    private readonly db: DbContextService,
    @Inject(ORDERS_REPOSITORY) private readonly orders: OrdersRepository,
  ) {}

  /**
   * Pose un hold sur le quota (creer_reservation) : verrou anti-survente,
   * plafond par utilisateur, TTL selon le mode de paiement. Aucune règle
   * métier ici, tout est dans la fonction SQL.
   */
  execute(actor: Actor, tarifId: number, quantite: number, modePaiement: ModePaiement): Promise<Reservation> {
    return this.db.asBuyer(actor.userId, (tx) => this.orders.hold(tx, actor.userId, tarifId, quantite, modePaiement));
  }
}

@Injectable()
export class ListMyHoldsUseCase {
  constructor(
    private readonly db: DbContextService,
    @Inject(ORDERS_REPOSITORY) private readonly orders: OrdersRepository,
  ) {}

  execute(actor: Actor): Promise<HoldView[]> {
    return this.db.asBuyer(actor.userId, (tx) => this.orders.listHoldsForBuyer(tx, actor.userId));
  }
}

@Injectable()
export class GetHoldUseCase {
  constructor(
    private readonly db: DbContextService,
    @Inject(ORDERS_REPOSITORY) private readonly orders: OrdersRepository,
  ) {}

  /** Le hold d'un autre répond 404, sans révéler son existence. */
  async execute(actor: Actor, reservationId: number): Promise<HoldView> {
    const hold = await this.db.asBuyer(actor.userId, (tx) =>
      this.orders.findHoldForBuyer(tx, actor.userId, reservationId),
    );
    if (!hold) throw notFound('Réservation');
    return hold;
  }
}

@Injectable()
export class CheckoutHoldUseCase {
  constructor(
    private readonly db: DbContextService,
    @Inject(ORDERS_REPOSITORY) private readonly orders: OrdersRepository,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly activity: ActivityLogger,
  ) {}

  /**
   * Ouvre le paiement par carte d'un hold. Le montant vient de PostgreSQL (prix
   * figé du hold), jamais du client. Aucune commande n'est créée ici : seul le
   * webhook signé du prestataire émet les billets. Exception : un montant nul
   * n'a rien à encaisser et est confirmé directement par la fonction SQL dédiée.
   */
  async execute(actor: Actor, reservationId: number): Promise<CheckoutResult> {
    const outcome = await this.db.asBuyer(actor.userId, async (tx) => {
      if (!(await this.orders.findHoldForBuyer(tx, actor.userId, reservationId))) throw notFound('Réservation');
      const preparation = await this.orders.prepareCheckout(tx, actor.userId, reservationId);
      const free =
        preparation.amountCents === 0 ? await this.orders.confirmFree(tx, actor.userId, reservationId) : null;
      return { preparation, free };
    });

    const { preparation, free } = outcome;
    if (free) {
      this.activity.record('achat', {
        utilisateurId: actor.userId,
        evenementId: preparation.evenementId,
        payload: { billets: preparation.quantite, montant: 0, moyen: 'gratuit' },
      });
      return { statut: 'confirmee', ...free };
    }

    // Appel réseau hors transaction : la base n'attend jamais le prestataire.
    const webUrl = this.config.CORS_ORIGIN.replace(/\/$/, '');
    const session = await this.gateway.createCheckoutSession({
      reservationId,
      userId: actor.userId,
      evenementId: preparation.evenementId,
      amountCents: preparation.amountCents,
      label: `${preparation.quantite} × ${preparation.tarif} — ${preparation.evenement}`,
      customerEmail: actor.email,
      successUrl: `${webUrl}/#/checkout/success?reservation=${reservationId}`,
      cancelUrl: `${webUrl}/#/checkout/success?reservation=${reservationId}&retour=annule`,
      expiresAt: new Date(Date.now() + CHECKOUT_SESSION_SECONDS * 1000),
    });
    return { statut: 'paiement', url: session.url };
  }
}

@Injectable()
export class CancelHoldUseCase {
  constructor(
    private readonly db: DbContextService,
    @Inject(ORDERS_REPOSITORY) private readonly orders: OrdersRepository,
  ) {}

  /** Rend les places d'un hold actif (annuler_reservation). */
  execute(actor: Actor, reservationId: number): Promise<void> {
    return this.db.asBuyer(actor.userId, async (tx) => {
      if (!(await this.orders.findHoldForBuyer(tx, actor.userId, reservationId))) throw notFound('Réservation');
      await this.orders.cancelHold(tx, actor.userId, reservationId);
    });
  }
}

@Injectable()
export class ListPendingTransfersUseCase {
  constructor(
    private readonly db: DbContextService,
    @Inject(ORDERS_REPOSITORY) private readonly orders: OrdersRepository,
  ) {}

  /** Organisateur : la RLS limite aux réservations de ses événements. */
  execute(actor: Actor): Promise<PendingTransfer[]> {
    return this.db.run({ userId: actor.userId, role: actor.role }, (tx) => this.orders.listPendingTransfers(tx));
  }
}

@Injectable()
export class ValidateTransferUseCase {
  constructor(
    private readonly db: DbContextService,
    @Inject(ORDERS_REPOSITORY) private readonly orders: OrdersRepository,
    private readonly activity: ActivityLogger,
  ) {}

  /**
   * Virement reçu : l'organisateur de l'événement (ou un admin) confirme le hold.
   * L'autorisation est vérifiée en base (valider_virement → BT013) ; une
   * réservation hors de son périmètre répond 404.
   */
  async execute(actor: Actor, reservationId: number): Promise<ConfirmResult> {
    const { target, result } = await this.db.run({ userId: actor.userId, role: actor.role }, async (tx) => {
      const target = await this.orders.findTransferTarget(tx, reservationId);
      if (!target) throw notFound('Réservation');
      return { target, result: await this.orders.validateTransfer(tx, reservationId) };
    });
    this.activity.record('achat', {
      utilisateurId: target.utilisateurId,
      evenementId: target.evenementId,
      payload: { billets: target.quantite, montant: Number(target.montantTotal), moyen: 'virement' },
    });
    return result;
  }
}
