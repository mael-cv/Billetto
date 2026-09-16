import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { Tx } from '../../../common/database/db-context.service';
import { offsetOf } from '../../../common/pagination';
import { toMoney, toNumber } from '../../../common/serialization';
import type { Pagination } from '../../../common/validation/schemas';
import type { OrderDetail, OrderStatus, OrderSummary, OrderTicket, OrdersRepository } from '../domain/order';

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
    return { ...toSummary(order), utilisateurId: toNumber(order.utilisateur_id), billets: tickets.map(toTicket) };
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
    return { ...toSummary(order), utilisateurId: toNumber(order.utilisateur_id), billets: tickets.map(toTicket) };
  }

  async refundAsOwner(tx: Tx, orderId: number): Promise<void> {
    await tx.$executeRaw`CALL rembourser_commande(${orderId}::bigint)`;
  }

  async refundAsAdmin(tx: Tx, orderId: number): Promise<void> {
    await tx.$executeRaw`CALL admin_rembourser_commande(${orderId}::bigint)`;
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
