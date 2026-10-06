import { Inject, Injectable } from '@nestjs/common';
import type { Actor } from '../../../auth/domain/actor';
import { DbContextService } from '../../../common/database/db-context.service';
import { mapPgError } from '../../../common/errors/pg-errors';
import {
  type BatchItem,
  CHECKIN_REPOSITORY,
  type CheckinRepository,
  type ManifestEntry,
  type ScanInput,
  type ScanOutcome,
} from '../domain/checkin';

// Aucune règle métier ici : signature, doublon et idempotence sont garantis
// par scanner_billet et les contraintes de billets_scans (011_checkin.sql).

@Injectable()
export class ScanTicketUseCase {
  constructor(
    private readonly db: DbContextService,
    @Inject(CHECKIN_REPOSITORY) private readonly checkin: CheckinRepository,
  ) {}

  execute(actor: Actor, input: ScanInput): Promise<ScanOutcome> {
    return this.db.run({ userId: actor.userId, role: actor.role }, (tx) => this.checkin.scan(tx, input));
  }
}

@Injectable()
export class ScanBatchUseCase {
  constructor(
    private readonly db: DbContextService,
    @Inject(CHECKIN_REPOSITORY) private readonly checkin: CheckinRepository,
  ) {}

  /**
   * Rejeu d'une file offline : une transaction par scan, pour qu'une erreur
   * métier (ex. événement d'un autre organisateur) n'annule pas les autres.
   * L'ordre importe peu : chaque scan est idempotent par clientScanId.
   * Une erreur non métier (base indisponible) interrompt le lot : le client
   * garde alors toute sa file et réessaiera.
   */
  async execute(actor: Actor, scans: ScanInput[]): Promise<BatchItem[]> {
    const results: BatchItem[] = [];
    for (const input of scans) {
      try {
        const outcome = await this.db.run({ userId: actor.userId, role: actor.role }, (tx) =>
          this.checkin.scan(tx, input),
        );
        results.push({ status: 'done', ...outcome });
      } catch (err) {
        const mapped = mapPgError(err);
        if (!mapped) throw err;
        results.push({ status: 'error', clientScanId: input.clientScanId, error: mapped.error, message: mapped.message });
      }
    }
    return results;
  }
}

@Injectable()
export class CheckinManifestUseCase {
  constructor(
    private readonly db: DbContextService,
    @Inject(CHECKIN_REPOSITORY) private readonly checkin: CheckinRepository,
  ) {}

  execute(actor: Actor, evenementId: number): Promise<ManifestEntry[]> {
    return this.db.run({ userId: actor.userId, role: actor.role }, (tx) => this.checkin.manifest(tx, evenementId));
  }
}
