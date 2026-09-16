import { Module } from '@nestjs/common';
import { AnalyticsUseCases } from './application/analytics.use-cases';
import { ANALYTICS_REPOSITORY } from './domain/analytics';
import { PrismaAnalyticsRepository } from './infrastructure/prisma-analytics.repository';
import { AnalyticsController } from './presentation/analytics.controller';

@Module({
  controllers: [AnalyticsController],
  providers: [AnalyticsUseCases, { provide: ANALYTICS_REPOSITORY, useClass: PrismaAnalyticsRepository }],
})
export class AnalyticsModule {}
