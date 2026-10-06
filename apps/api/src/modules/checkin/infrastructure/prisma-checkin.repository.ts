import { Injectable } from '@nestjs/common';
import type { Tx } from '../../../common/database/db-context.service';
import { toNumber } from '../../../common/serialization';
import type { CheckinRepository, ManifestEntry, ScanInput, ScanOutcome, ScanResult } from '../domain/checkin';

interface ScanRow {
  scan_id: bigint;
  client_scan_id: string;
  resultat: ScanResult;
  rejeu: boolean;
  billet_id: bigint | null;
  tarif: string | null;
  titulaire: string | null;
  scanne_a: Date;
  recu_a: Date;
  premier_scan_a: Date | null;
  premier_recu_a: Date | null;
  premier_appareil: string | null;
}

interface ManifestRow {
  billet_id: bigint;
  code_verification: string;
  tarif: string;
  titulaire: string;
  deja_scanne: boolean;
  scanne_a: Date | null;
}

@Injectable()
export class PrismaCheckinRepository implements CheckinRepository {
  async scan(tx: Tx, input: ScanInput): Promise<ScanOutcome> {
    const rows = await tx.$queryRaw<ScanRow[]>`
      SELECT scan_id, client_scan_id::text AS client_scan_id, resultat, rejeu, billet_id, tarif, titulaire,
             scanne_a, recu_a, premier_scan_a, premier_recu_a, premier_appareil
      FROM scanner_billet(${input.clientScanId}::uuid, ${input.payload}::text, ${input.evenementId}::bigint,
                          ${input.scanneA}::timestamptz, ${input.appareil ?? null}::text)`;
    const r = rows[0];
    if (!r) throw new Error('scanner_billet n’a renvoyé aucune ligne');
    return {
      scanId: toNumber(r.scan_id),
      clientScanId: r.client_scan_id,
      resultat: r.resultat,
      rejeu: r.rejeu,
      billetId: r.billet_id === null ? null : toNumber(r.billet_id),
      tarif: r.tarif,
      titulaire: r.titulaire,
      scanneA: r.scanne_a,
      recuA: r.recu_a,
      premierScan:
        r.premier_scan_a && r.premier_recu_a
          ? { scanneA: r.premier_scan_a, recuA: r.premier_recu_a, appareil: r.premier_appareil }
          : null,
    };
  }

  async manifest(tx: Tx, evenementId: number): Promise<ManifestEntry[]> {
    const rows = await tx.$queryRaw<ManifestRow[]>`
      SELECT billet_id, code_verification, tarif, titulaire, deja_scanne, scanne_a
      FROM manifeste_checkin(${evenementId}::bigint)`;
    return rows.map((r) => ({
      billetId: toNumber(r.billet_id),
      codeVerification: r.code_verification,
      tarif: r.tarif,
      titulaire: r.titulaire,
      dejaScanne: r.deja_scanne,
      scanneA: r.scanne_a,
    }));
  }
}
