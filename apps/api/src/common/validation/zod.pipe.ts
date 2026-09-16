import { HttpStatus, type PipeTransform } from '@nestjs/common';
import type { z } from 'zod';
import { ApiError } from '../errors/http-errors';

/**
 * Valide et normalise une entrée (body, query, param) avec un schéma Zod.
 * Les schémas de body sont stricts : une clé inconnue est refusée
 * (protection contre l'affectation de champs non prévus, ex. organisateur_id).
 */
export class ZodPipe<S extends z.ZodType> implements PipeTransform<unknown, z.output<S>> {
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.output<S> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION',
        'Requête invalide',
        result.error.issues.map((issue) => ({ champ: issue.path.join('.'), message: issue.message })),
      );
    }
    return result.data;
  }
}
