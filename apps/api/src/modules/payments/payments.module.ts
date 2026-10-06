import { Module } from '@nestjs/common';
import { ListOrderPaymentsUseCase } from './application/list-order-payments.use-case';
import { ProcessPaymentWebhookUseCase } from './application/process-payment-webhook.use-case';
import { PAYMENTS_REPOSITORY } from './domain/payment';
import { PAYMENT_WEBHOOK_REPOSITORY } from './domain/payment-webhook';
import { PrismaPaymentsRepository } from './infrastructure/prisma-payments.repository';
import { PrismaPaymentWebhookRepository } from './infrastructure/prisma-payment-webhook.repository';
import { PaymentsController } from './presentation/payments.controller';
import { PaymentWebhookController } from './presentation/payment-webhook.controller';
import { PaymentWebhookSignatureGuard } from './presentation/payment-webhook-signature.guard';

@Module({
  controllers: [PaymentsController, PaymentWebhookController],
  providers: [
    ListOrderPaymentsUseCase,
    ProcessPaymentWebhookUseCase,
    PaymentWebhookSignatureGuard,
    { provide: PAYMENTS_REPOSITORY, useClass: PrismaPaymentsRepository },
    { provide: PAYMENT_WEBHOOK_REPOSITORY, useClass: PrismaPaymentWebhookRepository },
  ],
})
export class PaymentsModule {}
