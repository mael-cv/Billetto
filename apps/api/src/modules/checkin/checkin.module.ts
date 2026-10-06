import { Module } from '@nestjs/common';
import { CheckinManifestUseCase, ScanBatchUseCase, ScanTicketUseCase } from './application/checkin.use-cases';
import { CHECKIN_REPOSITORY } from './domain/checkin';
import { PrismaCheckinRepository } from './infrastructure/prisma-checkin.repository';
import { CheckinController } from './presentation/checkin.controller';

@Module({
  controllers: [CheckinController],
  providers: [
    ScanTicketUseCase,
    ScanBatchUseCase,
    CheckinManifestUseCase,
    { provide: CHECKIN_REPOSITORY, useClass: PrismaCheckinRepository },
  ],
})
export class CheckinModule {}
