import { MongoServerError, MongoServerSelectionError } from 'mongodb';
import { mapMongoError } from './mongo-errors';

describe('erreurs MongoDB → HTTP', () => {
  it('index unique violé → 409 DOUBLON', () => {
    const err = new MongoServerError({ message: 'E11000 duplicate key', code: 11000 });
    expect(mapMongoError(err)).toEqual({ status: 409, error: 'DOUBLON', message: 'Cette ressource existe déjà' });
  });

  it('document refusé par le validateur → 422', () => {
    const err = new MongoServerError({ message: 'Document failed validation', code: 121 });
    expect(mapMongoError(err)?.status).toBe(422);
  });

  it('serveur injoignable → 503', () => {
    expect(mapMongoError(new MongoServerSelectionError('timeout', { message: 'x' } as never))?.status).toBe(503);
  });

  it('autre erreur → non reconnue (500 générique)', () => {
    expect(mapMongoError(new Error('x'))).toBeNull();
    expect(mapMongoError(new MongoServerError({ message: 'other', code: 2 }))).toBeNull();
  });
});
