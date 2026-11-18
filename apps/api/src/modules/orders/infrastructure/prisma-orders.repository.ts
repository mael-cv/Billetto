import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { Tx } from '../../../common/database/db-context.service';
import { offsetOf } from '../../../common/pagination';
import { toMoney, toNullableNumber, toNumber } from '../../../common/serialization';
import type { Pagination } from '../../../common/validation/schemas';
import type {
  CheckoutPreparation,
  ConfirmResult,
  HoldView,
  ModePaiement,
  OrderDetail,
  OrderStatus,
  OrderSummary,
  OrderTicket,
  OrdersRepository,
  PendingTransfer,
  Reservation,
  ReservationStatus,
  TransferTarget,
} from '../domain/order';

interface OrderRow {
  id: bigint;
  utilisateur_id: bigint;
  statut: OrderStatus;
  montant_total: Prisma.Decimal;
  created_at: Date;
  nb_billets: bigint;
}

interface TicketRow {
  billet_id: bigint;
  code: string;
  evenement_id: bigint;
  evenement: string;
  debut: Date;
  lieu: string;
  ville: string;
  tarif: string;
  prix_paye: Prisma.Decimal;
}

interface HoldRow {
  reservation_id: bigint;
  expire_a: Date;
  montant_total: Prisma.Decimal;
}

interface ConfirmRow {
  commande_id: bigint;
  billet_ids: bigint[];
}

interface HoldViewRow {
  id: bigint;
  tarif_id: bigint;
  tarif: string | null;
  evenement_id: bigint | null;
  evenement: string | null;
  quantite: number;
  statut: ReservationStatus;
  mode_paiement: ModePaiement;
  expire_a: Date;
  montant_total: Prisma.Decimal;
  commande_id: bigint | null;
  created_at: Date;
}

interface PreparationRow {
  montant_centimes: bigint;
  quantite: number;
  tarif: string;
  evenement_id: bigint;
  evenement: string;
  expire_a: Date;
}

interface TransferTargetRow {
  evenement_id: bigint;
  utilisateur_id: bigint;
  quantite: number;
  montant_total: Prisma.Decimal;
}

const toConfirm = (row: ConfirmRow | undefined, fn: string): ConfirmResult => {
  if (!row) throw new Error(`${fn} n’a renvoyé aucune ligne`);
  return { commandeId: toNumber(row.commande_id), billetIds: row.billet_ids.map(toNumber) };
};

const toHoldView = (r: HoldViewRow): HoldView => ({
  id: toNumber(r.id),
  tarifId: toNumber(r.tarif_id),
  tarif: r.tarif,
  evenementId: toNullableNumber(r.evenement_id),
  evenement: r.evenement,
  quantite: r.quantite,
  // Expiration « lazy » : un hold dépassé est expiré même si la purge n'est pas passée.
  statut: r.statut === 'active' && r.expire_a.getTime() <= Date.now() ? 'expiree' : r.statut,
  modePaiement: r.mode_paiement,
  expireA: r.expire_a,
  montantTotal: toMoney(r.montant_total),
  commandeId: toNullableNumber(r.commande_id),
  createdAt: r.created_at,
});

const toSummary = (r: OrderRow): OrderSummary => ({
  id: toNumber(r.id),
  statut: r.statut,
  montantTotal: toMoney(r.montant_total),
  createdAt: r.created_at,
  nbBillets: toNumber(r.nb_billets),
});

const toTicket = (t: TicketRow): OrderTicket => ({
  id: toNumber(t.billet_id),
  code: t.code,
  evenementId: toNumber(t.evenement_id),
  evenement: t.evenement,
  debut: t.debut,
  lieu: t.lieu,
  ville: t.ville,
  tarif: t.tarif,
  prixPaye: toMoney(t.prix_paye),
});

@Injectable()
export class PrismaOrdersRepository implements OrdersRepository {
  async listForBuyer(tx: Tx, userId: number, pagination: Pagination) {
    // Filtre explicite en plus de la RLS : défense en profondeur et intention lisible.
    const [countRows, rows] = await Promise.all([
      tx.$queryRaw<{ total: bigint }[]>`SELECT count(*) AS total FROM commandes WHERE utilisateur_id = ${userId}`,
      tx.$queryRaw<OrderRow[]>`
        SELECT c.id, c.utilisateur_id, c.statut, c.montant_total, c.created_at, count(b.id) AS nb_billets
        FROM commandes c
        LEFT JOIN billets b ON b.commande_id = c.id
        WHERE c.utilisateur_id = ${userId}
        GROUP BY c.id
        ORDER BY c.created_at DESC, c.id DESC
        LIMIT ${pagination.pageSize} OFFSET ${offsetOf(pagination)}`,
    ]);
    return { items: rows.map(toSummary), total: toNumber(countRows[0]?.total) };
  }

  async findForBuyer(tx: Tx, userId: number, orderId: number): Promise<OrderDetail | null> {
    const order = await this.orderRow(tx, orderId, userId);
    if (!order) return null;
    // billets_utilisateur (SECURITY DEFINER, contrôle d'identité) : l'acheteur voit
    // ses billets même si le tarif a été désactivé ou l'événement annulé.
    const tickets = await tx.$queryRaw<TicketRow[]>`
      SELECT billet_id, code::text AS code, evenement_id, evenement, debut, lieu, ville, tarif, prix_paye
      FROM billets_utilisateur(${userId}::bigint)
      WHERE commande_id = ${orderId}
      ORDER BY billet_id`;
    // limite_annulation : NULL pour la commande d'un autre (contrôle en base).
    const [limite] = await tx.$queryRaw<{ limite: Date | null }[]>`
      SELECT limite_annulation(${orderId}::bigint) AS limite`;
    return {
      ...toSummary(order),
      utilisateurId: toNumber(order.utilisateur_id),
      billets: tickets.map(toTicket),
      annulationPossibleJusqua: limite?.limite ?? null,
    };
  }

  async findAny(tx: Tx, orderId: number): Promise<OrderDetail | null> {
    const order = await this.orderRow(tx, orderId);
    if (!order) return null;
    const tickets = await tx.$queryRaw<TicketRow[]>`
      SELECT b.id AS billet_id, b.code::text AS code, e.id AS evenement_id, e.nom AS evenement, e.debut,
             l.nom AS lieu, l.ville, t.nom AS tarif, b.prix_paye
      FROM billets b
      JOIN tarifs t     ON t.id = b.tarif_id
      JOIN evenements e ON e.id = t.evenement_id
      JOIN lieux l      ON l.id = e.lieu_id
      WHERE b.commande_id = ${orderId}
      ORDER BY b.id`;
    return {
      ...toSummary(order),
      utilisateurId: toNumber(order.utilisateur_id),
      billets: tickets.map(toTicket),
      annulationPossibleJusqua: null,
    };
  }

  async refundAsOwner(tx: Tx, orderId: number): Promise<void> {
    await tx.$executeRaw`CALL rembourser_commande(${orderId}::bigint)`;
  }

  async refundAsAdmin(tx: Tx, orderId: number): Promise<void> {
    await tx.$executeRaw`CALL admin_rembourser_commande(${orderId}::bigint)`;
  }

  async hold(tx: Tx, userId: number, tarifId: number, quantite: number, modePaiement: ModePaiement): Promise<Reservation> {
    const rows = await tx.$queryRaw<HoldRow[]>`
      SELECT reservation_id, expire_a, montant_total
      FROM creer_reservation(${userId}::bigint, ${tarifId}::bigint, ${quantite}::integer, ${modePaiement}::text)`;
    const row = rows[0];
    if (!row) throw new Error('creer_reservation n’a renvoyé aucune ligne');
    return {
      id: toNumber(row.reservation_id),
      tarifId,
      quantite,
      statut: 'active',
      modePaiement,
      expireA: row.expire_a,
      montantTotal: toMoney(row.montant_total),
    };
  }

  async listHoldsForBuyer(tx: Tx, userId: number): Promise<HoldView[]> {
    return (await this.holdRows(tx, userId, null)).map(toHoldView);
  }

  async findHoldForBuyer(tx: Tx, userId: number, reservationId: number): Promise<HoldView | null> {
    const rows = await this.holdRows(tx, userId, reservationId);
    return rows[0] ? toHoldView(rows[0]) : null;
  }

  async prepareCheckout(tx: Tx, userId: number, reservationId: number): Promise<CheckoutPreparation> {
    const rows = await tx.$queryRaw<PreparationRow[]>`
      SELECT montant_centimes, quantite, tarif, evenement_id, evenement, expire_a
      FROM preparer_paiement_reservation(${reservationId}::bigint, ${userId}::bigint)`;
    const row = rows[0];
    if (!row) throw new Error('preparer_paiement_reservation n’a renvoyé aucune ligne');
    return {
      amountCents: toNumber(row.montant_centimes),
      quantite: row.quantite,
      tarif: row.tarif,
      evenementId: toNumber(row.evenement_id),
      evenement: row.evenement,
      expireA: row.expire_a,
    };
  }

  async confirmFree(tx: Tx, userId: number, reservationId: number): Promise<ConfirmResult> {
    const rows = await tx.$queryRaw<ConfirmRow[]>`
      SELECT commande_id, billet_ids
      FROM confirmer_reservation_gratuite(${reservationId}::bigint, ${userId}::bigint)`;
    return toConfirm(rows[0], 'confirmer_reservation_gratuite');
  }

  async cancelHold(tx: Tx, userId: number, reservationId: number): Promise<void> {
    await tx.$executeRaw`SELECT annuler_reservation(${reservationId}::bigint, ${userId}::bigint)`;
  }

  async listPendingTransfers(tx: Tx): Promise<PendingTransfer[]> {
    // RLS : l'organisateur ne lit que les réservations des tarifs de ses événements.
    const rows = await tx.$queryRaw<HoldViewRow[]>`
      SELECT r.id, r.tarif_id, t.nom AS tarif, e.id AS evenement_id, e.nom AS evenement, r.quantite, r.statut,
             r.mode_paiement, r.expire_a, r.prix_unitaire * r.quantite AS montant_total,
             r.commande_id, r.created_at
      FROM reservations r
      JOIN tarifs t     ON t.id = r.tarif_id
      JOIN evenements e ON e.id = t.evenement_id
      WHERE r.mode_paiement = 'virement' AND r.statut = 'active' AND r.expire_a > now()
      ORDER BY r.created_at, r.id
      LIMIT 200`;
    return rows.map((r) => ({
      id: toNumber(r.id),
      tarif: r.tarif ?? '',
      evenementId: toNumber(r.evenement_id),
      evenement: r.evenement ?? '',
      quantite: r.quantite,
      montantTotal: toMoney(r.montant_total),
      expireA: r.expire_a,
      createdAt: r.created_at,
    }));
  }

  async findTransferTarget(tx: Tx, reservationId: number): Promise<TransferTarget | null> {
    const rows = await tx.$queryRaw<TransferTargetRow[]>`
      SELECT t.evenement_id, r.utilisateur_id, r.quantite, r.prix_unitaire * r.quantite AS montant_total
      FROM reservations r
      JOIN tarifs t ON t.id = r.tarif_id
      WHERE r.id = ${reservationId}`;
    const row = rows[0];
    if (!row) return null;
    return {
      evenementId: toNumber(row.evenement_id),
      utilisateurId: toNumber(row.utilisateur_id),
      quantite: row.quantite,
      montantTotal: toMoney(row.montant_total),
    };
  }

  async validateTransfer(tx: Tx, reservationId: number): Promise<ConfirmResult> {
    const rows = await tx.$queryRaw<ConfirmRow[]>`
      SELECT commande_id, billet_ids FROM valider_virement(${reservationId}::bigint)`;
    return toConfirm(rows[0], 'valider_virement');
  }

  // Filtre explicite en plus de la RLS : défense en profondeur. LEFT JOIN : le
  // hold reste visible si le tarif ou l'événement ne l'est plus pour un visiteur.
  private holdRows(tx: Tx, userId: number, reservationId: number | null): Promise<HoldViewRow[]> {
    return tx.$queryRaw<HoldViewRow[]>`
      SELECT r.id, r.tarif_id, t.nom AS tarif, e.id AS evenement_id, e.nom AS evenement, r.quantite, r.statut,
             r.mode_paiement, r.expire_a, r.prix_unitaire * r.quantite AS montant_total,
             r.commande_id, r.created_at
      FROM reservations r
      LEFT JOIN tarifs t     ON t.id = r.tarif_id
      LEFT JOIN evenements e ON e.id = t.evenement_id
      WHERE r.utilisateur_id = ${userId}
        AND (${reservationId}::bigint IS NULL OR r.id = ${reservationId}::bigint)
      ORDER BY r.created_at DESC, r.id DESC
      LIMIT 50`;
  }

  private async orderRow(tx: Tx, orderId: number, userId?: number): Promise<OrderRow | null> {
    const rows = await tx.$queryRaw<OrderRow[]>`
      SELECT c.id, c.utilisateur_id, c.statut, c.montant_total, c.created_at,
             (SELECT count(*) FROM billets b WHERE b.commande_id = c.id) AS nb_billets
      FROM commandes c
      WHERE c.id = ${orderId}
        AND (${userId ?? null}::bigint IS NULL OR c.utilisateur_id = ${userId ?? null}::bigint)`;
    return rows[0] ?? null;
  }
}
