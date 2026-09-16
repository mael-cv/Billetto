import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { Tx } from '../../../common/database/db-context.service';
import { offsetOf } from '../../../common/pagination';
import { toMoney, toNumber } from '../../../common/serialization';
import type { Pagination } from '../../../common/validation/schemas';
import type { MyTicket, PurchaseResult, TicketsRepository } from '../domain/ticket';

interface PurchaseRow {
  commande_id: bigint;
  paiement_id: bigint;
  billet_ids: bigint[];
  montant_total: Prisma.Decimal;
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
  commande_id: bigint;
  statut_commande: MyTicket['statutCommande'];
}

@Injectable()
export class PrismaTicketsRepository implements TicketsRepository {
  async purchase(tx: Tx, userId: number, tarifId: number, quantite: number): Promise<PurchaseResult> {
    const rows = await tx.$queryRaw<PurchaseRow[]>`
      SELECT commande_id, paiement_id, billet_ids, montant_total
      FROM acheter_billet(${userId}::bigint, ${tarifId}::bigint, ${quantite}::integer)`;
    const row = rows[0];
    if (!row) throw new Error('acheter_billet n’a renvoyé aucune ligne');
    return {
      commandeId: toNumber(row.commande_id),
      paiementId: toNumber(row.paiement_id),
      billetIds: row.billet_ids.map(toNumber),
      montantTotal: toMoney(row.montant_total),
    };
  }

  async listForUser(tx: Tx, userId: number, pagination: Pagination) {
    const [countRows, rows] = await Promise.all([
      tx.$queryRaw<{ total: bigint }[]>`SELECT count(*) AS total FROM billets_utilisateur(${userId}::bigint)`,
      tx.$queryRaw<TicketRow[]>`
        SELECT billet_id, code::text AS code, evenement_id, evenement, debut, lieu, ville, tarif,
               prix_paye, commande_id, statut_commande
        FROM billets_utilisateur(${userId}::bigint)
        LIMIT ${pagination.pageSize} OFFSET ${offsetOf(pagination)}`,
    ]);
    const items: MyTicket[] = rows.map((t) => ({
      id: toNumber(t.billet_id),
      code: t.code,
      evenementId: toNumber(t.evenement_id),
      evenement: t.evenement,
      debut: t.debut,
      lieu: t.lieu,
      ville: t.ville,
      tarif: t.tarif,
      prixPaye: toMoney(t.prix_paye),
      commandeId: toNumber(t.commande_id),
      statutCommande: t.statut_commande,
    }));
    return { items, total: toNumber(countRows[0]?.total) };
  }
}
