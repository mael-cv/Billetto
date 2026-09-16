import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { mapPgError } from './pg-errors';

export interface ErrorBody {
  statusCode: number;
  error: string;
  message: string;
  details?: unknown;
  requestId?: string;
}

/**
 * Format d'erreur unique. Jamais de stacktrace ni de message technique vers le
 * client : les erreurs non reconnues sont journalisées côté serveur et renvoyées
 * en 500 générique.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Erreurs');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const reply = http.getResponse<FastifyReply>();
    const request = http.getRequest<FastifyRequest>();
    const body = this.toBody(exception);
    body.requestId = request.id;

    if (body.statusCode >= 500) {
      this.logger.error(
        `${request.method} ${request.routeOptions?.url ?? ''} → ${body.statusCode} [${request.id}]`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }
    void reply.status(body.statusCode).send(body);
  }

  private toBody(exception: unknown): ErrorBody {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      if (typeof response === 'object' && response !== null) {
        const r = response as Record<string, unknown>;
        return {
          statusCode: status,
          error: typeof r.error === 'string' ? r.error : exception.name,
          message: typeof r.message === 'string' ? r.message : exception.message,
          ...(r.details !== undefined ? { details: r.details } : {}),
        };
      }
      return { statusCode: status, error: exception.name, message: String(response) };
    }

    const pg = mapPgError(exception);
    if (pg) return { statusCode: pg.status, error: pg.error, message: pg.message };

    // Erreurs Fastify (payload trop gros, JSON invalide…) : statut conservé, message générique.
    const statusCode = (exception as { statusCode?: unknown })?.statusCode;
    if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500) {
      return { statusCode, error: 'REQUETE_INVALIDE', message: 'Requête invalide' };
    }

    return { statusCode: 500, error: 'ERREUR_INTERNE', message: 'Erreur interne' };
  }
}
