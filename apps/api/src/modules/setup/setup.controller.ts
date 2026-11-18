import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { z } from 'zod';
import { AllowDuringSetup, Public } from '../../auth/presentation/auth.decorators';
import { email, newPassword } from '../../auth/presentation/auth.dto';
import { text } from '../../common/validation/schemas';
import { ZodPipe } from '../../common/validation/zod.pipe';
import { SetupService } from './setup.service';

// Objet strict : aucun champ en plus (rôle, identifiant, mode inconnu…) n'est accepté.
export const setupSchema = z
  .strictObject({
    jeton: z.string().min(20).max(100),
    mode: z.enum(['test', 'live']),
    stripe: z
      .strictObject({
        // Clés réelles uniquement : les clés de test viennent du fichier versionné.
        secretKey: z.string().regex(/^(sk|rk)_live_[A-Za-z0-9]{16,200}$/, 'clé Stripe réelle attendue (sk_live_… ou rk_live_…)'),
        webhookSecret: z.string().regex(/^whsec_[A-Za-z0-9+/=_-]{24,200}$/, 'secret de webhook Stripe attendu (whsec_…)'),
      })
      .optional(),
    admin: z.strictObject({ email, password: newPassword, prenom: text(80), nom: text(80) }),
  })
  .refine((value) => (value.mode === 'live') === (value.stripe !== undefined), {
    path: ['stripe'],
    message: 'clés Stripe requises en mode live, interdites en mode test',
  });

@Controller('setup')
@AllowDuringSetup()
export class SetupController {
  constructor(private readonly setup: SetupService) {}

  /** État de l'installation : seul renseignement public tant que l'application n'est pas initialisée. */
  @Get('status')
  @Public()
  status() {
    return this.setup.status();
  }

  /**
   * Dépose la demande d'installation. Protégée par le jeton à usage unique des
   * journaux de démarrage, le jeton CSRF et une limite de débit stricte.
   * Définitivement refusée (409) une fois l'application initialisée.
   */
  @Post()
  @Public()
  @HttpCode(202)
  submit(@Body(new ZodPipe(setupSchema)) body: z.infer<typeof setupSchema>) {
    return this.setup.submit(body);
  }
}
