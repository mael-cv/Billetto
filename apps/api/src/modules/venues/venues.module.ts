import { Module } from '@nestjs/common';
import { ListVenuesUseCase } from './application/list-venues.use-case';
import { VENUES_REPOSITORY } from './domain/venue';
import { PrismaVenuesRepository } from './infrastructure/prisma-venues.repository';
import { VenuesController } from './presentation/venues.controller';

@Module({
  controllers: [VenuesController],
  providers: [ListVenuesUseCase, { provide: VENUES_REPOSITORY, useClass: PrismaVenuesRepository }],
})
export class VenuesModule {}
