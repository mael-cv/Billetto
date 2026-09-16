import { Prisma } from '@prisma/client';
import { extractPgError, mapPgError } from './pg-errors';

const rawQueryError = (code: string, message: string) =>
  new Prisma.PrismaClientKnownRequestError(`Raw query failed. Code: \`${code}\`. Message: \`${message}\``, {
    code: 'P2010',
    clientVersion: 'test',
    meta: { code, message },
  });

describe('mapPgError', () => {
  it('traduit un code métier en conservant le message métier', () => {
    const mapped = mapPgError(rawQueryError('BT006', 'ERROR: quota épuisé pour le tarif 12 : 0 restant(s), 1 demandé(s)'));
    expect(mapped).toEqual({
      status: 409,
      error: 'QUOTA_EPUISE',
      message: 'quota épuisé pour le tarif 12 : 0 restant(s), 1 demandé(s)',
    });
  });

  it.each([
    ['BT001', 404, 'TARIF_INTROUVABLE'],
    ['BT005', 409, 'EVENEMENT_COMMENCE'],
    ['BT007', 422, 'QUANTITE_INVALIDE'],
    ['BT013', 403, 'ACTION_INTERDITE'],
  ])('%s → %i %s', (code, status, error) => {
    expect(mapPgError(rawQueryError(code, 'x'))).toMatchObject({ status, error });
  });

  it('masque le message technique des erreurs de droits', () => {
    const mapped = mapPgError(rawQueryError('42501', 'permission denied for table utilisateurs'));
    expect(mapped).toEqual({ status: 403, error: 'ACCES_REFUSE', message: 'Accès refusé' });
  });

  it('traduit les erreurs Prisma de contrainte', () => {
    const unique = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: 'test',
    });
    expect(mapPgError(unique)).toMatchObject({ status: 409, error: 'CONFLIT' });
  });

  it('reconnaît une violation de RLS dans une erreur Prisma non typée', () => {
    const err = new Prisma.PrismaClientUnknownRequestError('new row violates row-level security policy for table "evenements"', {
      clientVersion: 'test',
    });
    expect(extractPgError(err)).toEqual({ sqlState: '42501' });
  });

  it('ignore les erreurs non PostgreSQL et les codes inconnus', () => {
    expect(mapPgError(new Error('boom'))).toBeNull();
    expect(mapPgError(rawQueryError('XX000', 'internal'))).toBeNull();
  });
});
