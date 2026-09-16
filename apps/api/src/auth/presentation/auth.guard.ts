import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AppRole } from '../../common/database/db-context.service';
import { forbidden, unauthorized } from '../../common/errors/http-errors';
import { SessionTokenService } from '../application/session-token.service';
import { ROLES_KEY, type RequestWithActor } from './auth.decorators';
import { SESSION_COOKIE } from './cookies';

/**
 * Guard global : identifie l'utilisateur depuis le cookie de session (toujours),
 * puis applique @Authenticated(...) si la route le demande.
 * Ce contrôle est une première barrière ; PostgreSQL (GRANT + RLS) reste l'autorité
 * sur ce que l'utilisateur peut voir et modifier.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: SessionTokenService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithActor>();
    request.actor = this.tokens.verify(request.cookies?.[SESSION_COOKIE]);

    const roles = this.reflector.getAllAndOverride<AppRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (roles === undefined) return true;
    if (!request.actor) throw unauthorized();
    if (roles.length > 0 && !roles.includes(request.actor.role)) throw forbidden();
    return true;
  }
}
