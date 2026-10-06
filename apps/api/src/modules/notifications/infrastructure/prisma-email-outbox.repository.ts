import { Injectable } from '@nestjs/common';
import type { Tx } from '../../../common/database/db-context.service';
import { toNumber } from '../../../common/serialization';
import type { EmailOutboxRepository, EmailType, PendingEmail } from '../domain/email';

interface ClaimRow {
  email_id: bigint;
  type: EmailType;
  destinataire: string;
  prenom: string;
  tentatives: number;
  donnees: PendingEmail['donnees'];
}

@Injectable()
export class PrismaEmailOutboxRepository implements EmailOutboxRepository {
  async claim(tx: Tx, limit: number): Promise<PendingEmail[]> {
    const rows = await tx.$queryRaw<ClaimRow[]>`
      SELECT email_id, type, destinataire, prenom, tentatives, donnees FROM emails_a_envoyer(${limit}::integer)`;
    return rows.map(
      (r) =>
        ({
          emailId: toNumber(r.email_id),
          type: r.type,
          destinataire: r.destinataire,
          prenom: r.prenom,
          tentatives: r.tentatives,
          donnees: r.donnees,
        }) as PendingEmail,
    );
  }

  async mark(tx: Tx, emailId: number, ok: boolean, error?: string): Promise<void> {
    await tx.$executeRaw`SELECT marquer_email(${emailId}::bigint, ${ok}, ${error ?? null}::text)`;
  }
}
