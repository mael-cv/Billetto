import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { AppRole } from '../../common/database/db-context.service';
import type { Actor } from '../domain/actor';

export const ROLES_KEY = 'billetto:roles';
export const SKIP_CSRF_KEY = 'billetto:skip-csrf';

/** Route réservée aux utilisateurs connectés ; restreinte aux rôles listés s'ils sont fournis. */
export const Authenticated = (...roles: AppRole[]) => SetMetadata(ROLES_KEY, roles);

/** Uniquement pour les méthodes sûres qui émettent le jeton CSRF. */
export const SkipCsrf = () => SetMetadata(SKIP_CSRF_KEY, true);

export type RequestWithActor = FastifyRequest & { actor?: Actor | null };

/** Utilisateur courant (null si anonyme). */
export const CurrentActor = createParamDecorator((_: unknown, ctx: ExecutionContext): Actor | null => {
  return ctx.switchToHttp().getRequest<RequestWithActor>().actor ?? null;
});
