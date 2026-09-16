import { HttpException, HttpStatus } from '@nestjs/common';

/** Erreur HTTP applicative au format { error, message }. */
export class ApiError extends HttpException {
  constructor(status: HttpStatus, error: string, message: string, details?: unknown) {
    super({ error, message, ...(details !== undefined ? { details } : {}) }, status);
  }
}

export const notFound = (what: string): ApiError =>
  new ApiError(HttpStatus.NOT_FOUND, 'INTROUVABLE', `${what} introuvable`);

export const forbidden = (message = 'Accès refusé'): ApiError =>
  new ApiError(HttpStatus.FORBIDDEN, 'ACCES_REFUSE', message);

export const unauthorized = (message = 'Authentification requise'): ApiError =>
  new ApiError(HttpStatus.UNAUTHORIZED, 'NON_AUTHENTIFIE', message);
