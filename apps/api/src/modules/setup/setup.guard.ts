import { type CanActivate, type ExecutionContext, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ALLOW_DURING_SETUP_KEY } from '../../auth/presentation/auth.decorators';
import { APP_CONFIG, type AppConfig } from '../../common/config/config';
import { ApiError } from '../../common/errors/http-errors';

/**
 * Tant que l'application n'est pas initialisée, rien ne répond hormis
 * l'assistant, la santé et l'émission du jeton CSRF : aucune inscription,
 * aucune lecture, aucun webhook ne peut précéder la création du premier administrateur.
 */
@Injectable()
export class SetupGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (this.config.APP_MODE !== 'setup') return true;
    const allowed = this.reflector.getAllAndOverride<boolean>(ALLOW_DURING_SETUP_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (allowed) return true;
    throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'SETUP_REQUIS', 'L’application n’est pas encore initialisée');
  }
}
