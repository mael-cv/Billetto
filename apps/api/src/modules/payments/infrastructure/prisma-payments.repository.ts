import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { Tx } from '../../../common/database/db-context.service';
import { toMoney, toNumber } from '../../../common/serialization';
import type { Payment, PaymentsRepository } from '../domain/payment';

interface Row {
  id: bigint;
  reference: string;
  type: Payment['type'];
  montant: Prisma.Decimal;
  statut: Payment['statut'];
  created_at: Date;
}

@Injectable()
export class PrismaPaymentsRepository implements PaymentsRepository {
  async listForOrder(tx: Tx, orderId: number, ownerId: number | null): Promise<Payment[] | null> {
    const order = await tx.$queryRaw<unknown[]>`
      SELECT 1 FROM commandes
      WHERE id = ${orderId} AND (${ownerId}::bigint IS NULL OR utilisateur_id = ${ownerId}::bigint)`;
    if (order.length === 0) return null;

    const rows = await tx.$queryRaw<Row[]>`
      SELECT id, reference, type, montant, statut, created_at
      FROM paiements
      WHERE commande_id = ${orderId}
      ORDER BY created_at, id`;
    return rows.map((r) => ({
      id: toNumber(r.id),
      reference: r.reference,
      type: r.type,
      montant: toMoney(r.montant),
      statut: r.statut,
      createdAt: r.created_at,
    }));
  }
}
