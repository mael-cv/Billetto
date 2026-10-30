import { MongoServerError, MongoServerSelectionError } from 'mongodb';
import type { HttpErrorShape } from './pg-errors';

/**
 * Traduction des erreurs MongoDB en erreurs HTTP, sans jamais renvoyer le
 * message technique (noms de collections, valeurs) au client.
 *   11000 : violation d'index unique       → 409
 *   121   : document refusé par le validateur $jsonSchema → 422
 *   serveur injoignable                    → 503
 */
export function mapMongoError(err: unknown): HttpErrorShape | null {
  if (err instanceof MongoServerSelectionError) {
    return { status: 503, error: 'NOSQL_INDISPONIBLE', message: 'Base documentaire indisponible' };
  }
  if (err instanceof MongoServerError) {
    if (err.code === 11000) return { status: 409, error: 'DOUBLON', message: 'Cette ressource existe déjà' };
    if (err.code === 121) return { status: 422, error: 'DOCUMENT_INVALIDE', message: 'Document refusé par le schéma' };
  }
  return null;
}
