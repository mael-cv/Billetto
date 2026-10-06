import { Inject, type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AppRole } from '../../common/database/db-context.service';
import { forbidden, unauthorized } from '../../common/errors/http-errors';
import { SessionTokenService } from '../application/session-token.service';
import { CREDENTIALS_REPOSITORY, type CredentialsRepository } from '../domain/credentials.repository';
import { OPTIONAL_AUTH_KEY, PUBLIC_ACCESS_KEY, ROLES_KEY, type RequestWithActor } from './auth.decorators';
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
    @Inject(CREDENTIALS_REPOSITORY) private readonly credentials: CredentialsRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithActor>();
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_ACCESS_KEY, targets)) {
      request.actor = null;
      return true;
    }

    const actor = this.tokens.verify(request.cookies?.[SESSION_COOKIE]);
    request.actor = actor;
    if (actor) {
      const version = await this.credentials.sessionVersion(actor.userId);
      if (version === null || version !== actor.authVersion) request.actor = null;
    }

    const roles = this.reflector.getAllAndOverride<AppRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const optional = this.reflector.getAllAndOverride<boolean>(OPTIONAL_AUTH_KEY, targets);
    if (roles === undefined && optional) return true;
    if (roles === undefined) throw unauthorized();
    if (!request.actor) throw unauthorized();
    if (roles.length > 0 && !roles.includes(request.actor.role)) throw forbidden();
    return true;
  }
}
