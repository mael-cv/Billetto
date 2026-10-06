import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { Public, SkipCsrf } from '../../../auth/presentation/auth.decorators';
import { idSchema } from '../../../common/validation/schemas';
import { ZodPipe } from '../../../common/validation/zod.pipe';
import { ProcessPaymentWebhookUseCase } from '../application/process-payment-webhook.use-case';
import { PaymentWebhookSignatureGuard } from './payment-webhook-signature.guard';

const webhookSchema = z.strictObject({
  eventId: z.string().trim().min(1).max(255),
  type: z.string().trim().min(1).max(100),
  reservationId: idSchema,
});

@Controller('payments')
export class PaymentWebhookController {
  constructor(private readonly processWebhook: ProcessPaymentWebhookUseCase) {}

  @Post('webhook')
  @Public()
  @HttpCode(200)
  @SkipCsrf()
  @UseGuards(PaymentWebhookSignatureGuard)
  receive(@Body(new ZodPipe(webhookSchema)) body: z.infer<typeof webhookSchema>) {
    return this.processWebhook.execute({
      ...body,
      payload: body as Record<string, unknown>,
    });
  }
}
