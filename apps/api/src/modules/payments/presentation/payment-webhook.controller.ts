import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { Public, SkipCsrf } from '../../../auth/presentation/auth.decorators';
import { ZodPipe } from '../../../common/validation/zod.pipe';
import { ProcessPaymentWebhookUseCase } from '../application/process-payment-webhook.use-case';
import { PaymentWebhookSignatureGuard } from './payment-webhook-signature.guard';

// Événement Stripe : seuls ces champs sont lus (les autres sont ignorés). Le
// contenu fait l'objet d'une relecture auprès de Stripe avant toute action.
const webhookSchema = z.object({
  id: z.string().regex(/^evt_[A-Za-z0-9_]{1,250}$/),
  type: z.string().trim().min(1).max(100),
  data: z.object({ object: z.object({ id: z.string().max(255) }) }),
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
    return this.processWebhook.execute({ eventId: body.id, type: body.type, sessionId: body.data.object.id });
  }
}
