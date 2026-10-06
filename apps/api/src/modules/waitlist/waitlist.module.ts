import { Module } from '@nestjs/common';
import {
  CancelWaitlistUseCase,
  ConfirmWaitlistUseCase,
  JoinWaitlistUseCase,
  ListMyWaitlistUseCase,
  TarifWaitlistUseCase,
} from './application/waitlist.use-cases';
import { WAITLIST_REPOSITORY } from './domain/waitlist';
import { PrismaWaitlistRepository } from './infrastructure/prisma-waitlist.repository';
import { WaitlistController } from './presentation/waitlist.controller';

@Module({
  controllers: [WaitlistController],
  providers: [
    JoinWaitlistUseCase,
    ListMyWaitlistUseCase,
    ConfirmWaitlistUseCase,
    CancelWaitlistUseCase,
    TarifWaitlistUseCase,
    { provide: WAITLIST_REPOSITORY, useClass: PrismaWaitlistRepository },
  ],
})
export class WaitlistModule {}
