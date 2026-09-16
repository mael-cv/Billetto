import { Controller, Get, HttpStatus } from '@nestjs/common';
import { DbContextService } from '../../common/database/db-context.service';
import { ApiError } from '../../common/errors/http-errors';

@Controller('health')
export class HealthController {
  constructor(private readonly db: DbContextService) {}

  @Get()
  async check(): Promise<{ status: 'ok'; database: 'up' }> {
    try {
      await this.db.raw().$queryRaw`SELECT 1`;
    } catch {
      throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'BASE_INDISPONIBLE', 'Base de données indisponible');
    }
    return { status: 'ok', database: 'up' };
  }
}
