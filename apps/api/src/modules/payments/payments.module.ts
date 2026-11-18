import { Global, Module } from '@nestjs/common';
import { ListOrderPaymentsUseCase } from './application/list-order-payments.use-case';
import { ProcessPaymentWebhookUseCase } from './application/process-payment-webhook.use-case';
import { PAYMENTS_REPOSITORY } from './domain/payment';
import { PAYMENT_GATEWAY } from './domain/payment-gateway';
import { PAYMENT_WEBHOOK_REPOSITORY } from './domain/payment-webhook';
import { PrismaPaymentsRepository } from './infrastructure/prisma-payments.repository';
import { PrismaPaymentWebhookRepository } from './infrastructure/prisma-payment-webhook.repository';
import { StripeGateway } from './infrastructure/stripe.gateway';
import { PaymentsController } from './presentation/payments.controller';
import { PaymentWebhookController } from './presentation/payment-webhook.controller';
import { PaymentWebhookSignatureGuard } from './presentation/payment-webhook-signature.guard';

/** Global : la passerelle de paiement est aussi utilisée par le module des commandes. */
@Global()
@Module({
  controllers: [PaymentsController, PaymentWebhookController],
  providers: [
    ListOrderPaymentsUseCase,
    ProcessPaymentWebhookUseCase,
    PaymentWebhookSignatureGuard,
    { provide: PAYMENTS_REPOSITORY, useClass: PrismaPaymentsRepository },
    { provide: PAYMENT_WEBHOOK_REPOSITORY, useClass: PrismaPaymentWebhookRepository },
    { provide: PAYMENT_GATEWAY, useClass: StripeGateway },
  ],
  exports: [PAYMENT_GATEWAY],
})
export class PaymentsModule {}
