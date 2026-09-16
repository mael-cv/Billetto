import { timingSafeEqual } from 'node:crypto';
import { type CanActivate, type ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { ApiError } from '../../common/errors/http-errors';
import { SKIP_CSRF_KEY } from './auth.decorators';
import { CSRF_COOKIE, CSRF_HEADER } from './cookies';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Toute requête modifiante (y compris login et register, contre le « login CSRF »)
 * doit porter un en-tête X-CSRF-Token identique au cookie billetto_csrf.
 * Complète SameSite=Strict, qui ne protège pas les anciens navigateurs.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (SAFE_METHODS.has(request.method)) return true;
    if (this.reflector.getAllAndOverride<boolean>(SKIP_CSRF_KEY, [context.getHandler(), context.getClass()])) {
      return true;
    }

    const cookie = request.cookies?.[CSRF_COOKIE];
    const header = request.headers[CSRF_HEADER];
    if (typeof cookie !== 'string' || typeof header !== 'string' || cookie.length < 32) {
      throw csrfError();
    }
    const a = Buffer.from(cookie);
    const b = Buffer.from(header);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw csrfError();
    return true;
  }
}

const csrfError = () => new ApiError(HttpStatus.FORBIDDEN, 'CSRF_INVALIDE', 'Jeton CSRF absent ou invalide');
