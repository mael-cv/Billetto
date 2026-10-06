import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { DbContextService } from '../../../common/database/db-context.service';

const DEFAULT_INTERVAL_MS = 60_000;

/**
 * Marque périodiquement les réservations expirées (statut = 'expiree').
 * Reporting uniquement : l'anti-survente repose sur expire_a > now() dans
 * places_occupees(), jamais sur ce job. RESERVATIONS_PURGE_INTERVAL_MS=0 le désactive.
 */
@Injectable()
export class ReservationsPurgeJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReservationsPurgeJob.name);
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly db: DbContextService) {}

  onModuleInit(): void {
    const interval = Number(process.env.RESERVATIONS_PURGE_INTERVAL_MS ?? DEFAULT_INTERVAL_MS);
    if (!Number.isFinite(interval) || interval <= 0) return;
    this.timer = setInterval(() => void this.purge(), interval);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  async purge(): Promise<void> {
    try {
      await this.db.run({ userId: null, role: 'admin' }, (tx) => tx.$executeRaw`CALL purger_reservations_expirees()`);
    } catch (err) {
      this.logger.error(`purge des réservations expirées impossible : ${String(err)}`);
    }
  }
}
