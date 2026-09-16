import { Module } from '@nestjs/common';
import {
  CreatePriceUseCase,
  DeletePriceUseCase,
  ListPricesUseCase,
  UpdatePriceUseCase,
} from './application/pricing.use-cases';
import { PRICING_REPOSITORY } from './domain/pricing.repository';
import { PrismaPricingRepository } from './infrastructure/prisma-pricing.repository';
import { PricingController } from './presentation/pricing.controller';

@Module({
  controllers: [PricingController],
  providers: [
    ListPricesUseCase,
    CreatePriceUseCase,
    UpdatePriceUseCase,
    DeletePriceUseCase,
    { provide: PRICING_REPOSITORY, useClass: PrismaPricingRepository },
  ],
})
export class PricingModule {}
