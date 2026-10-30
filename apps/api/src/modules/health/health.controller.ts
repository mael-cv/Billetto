import { Controller, Get, HttpStatus } from '@nestjs/common';
import { DbContextService } from '../../common/database/db-context.service';
import { ApiError } from '../../common/errors/http-errors';
import { MongoService } from '../../common/mongodb/mongo.service';
import { Public } from '../../auth/presentation/auth.decorators';

@Controller('health')
export class HealthController {
  constructor(
    private readonly db: DbContextService,
    private readonly mongo: MongoService,
  ) {}

  /** Santé des deux bases : PostgreSQL (SELECT 1) et MongoDB (ping). 503 si l'une manque. */
  @Get()
  @Public()
  async check(): Promise<{ status: 'ok'; database: 'up'; mongodb: 'up' }> {
    let postgres = false;
    try {
      await this.db.raw().$queryRaw`SELECT 1`;
      postgres = true;
    } catch {
      postgres = false;
    }
    const mongodb = await this.mongo.ping();
    if (!postgres || !mongodb) {
      throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'BASE_INDISPONIBLE', 'Base de données indisponible', {
        postgres: postgres ? 'up' : 'down',
        mongodb: mongodb ? 'up' : 'down',
      });
    }
    return { status: 'ok', database: 'up', mongodb: 'up' };
  }
}
