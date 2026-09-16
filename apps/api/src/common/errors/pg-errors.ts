import { Prisma } from '@prisma/client';

export interface HttpErrorShape {
  status: number;
  error: string;
  message: string;
}

interface Mapping {
  status: number;
  error: string;
  /** Message renvoyé au client. Absent : le message métier de PostgreSQL est conservé. */
  message?: string;
}

// Codes métier levés par les fonctions SQL (voir doc/database.md) et codes
// PostgreSQL standards. Les messages techniques (noms de tables, contraintes)
// ne sont jamais renvoyés au client.
const SQLSTATE_MAP: Record<string, Mapping> = {
  BT001: { status: 404, error: 'TARIF_INTROUVABLE' },
  BT002: { status: 409, error: 'TARIF_INACTIF' },
  BT003: { status: 409, error: 'EVENEMENT_NON_PUBLIE' },
  BT004: { status: 409, error: 'VENTE_FERMEE' },
  BT005: { status: 409, error: 'EVENEMENT_COMMENCE' },
  BT006: { status: 409, error: 'QUOTA_EPUISE' },
  BT007: { status: 422, error: 'QUANTITE_INVALIDE' },
  BT008: { status: 404, error: 'UTILISATEUR_INTROUVABLE' },
  BT010: { status: 404, error: 'COMMANDE_INTROUVABLE' },
  BT011: { status: 409, error: 'COMMANDE_NON_REMBOURSABLE' },
  BT012: { status: 409, error: 'REMBOURSEMENT_IMPOSSIBLE' },
  BT013: { status: 403, error: 'ACTION_INTERDITE', message: 'Action interdite pour ce compte' },
  BT020: { status: 422, error: 'ATTRIBUT_INVALIDE' },
  '42501': { status: 403, error: 'ACCES_REFUSE', message: 'Accès refusé' },
  '23505': { status: 409, error: 'CONFLIT', message: 'Cette ressource existe déjà' },
  '23503': { status: 409, error: 'REFERENCE_INVALIDE', message: 'Ressource liée inexistante ou encore utilisée' },
  '23514': { status: 422, error: 'CONTRAINTE_VIOLEE', message: 'Données incohérentes' },
  '22P02': { status: 400, error: 'VALEUR_INVALIDE', message: 'Valeur invalide' },
  '22007': { status: 400, error: 'VALEUR_INVALIDE', message: 'Date invalide' },
  '22008': { status: 400, error: 'VALEUR_INVALIDE', message: 'Date hors limites' },
  '22003': { status: 400, error: 'VALEUR_INVALIDE', message: 'Nombre hors limites' },
};

const PRISMA_CODE_TO_SQLSTATE: Record<string, string> = {
  P2002: '23505',
  P2003: '23503',
  P2004: '23514',
};

/** Extrait le SQLSTATE et le message PostgreSQL d'une erreur Prisma. */
export function extractPgError(err: unknown): { sqlState: string; pgMessage?: string } | null {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    const meta = (err.meta ?? {}) as Record<string, unknown>;
    if (err.code === 'P2010' && typeof meta.code === 'string') {
      return { sqlState: meta.code, pgMessage: typeof meta.message === 'string' ? meta.message : undefined };
    }
    const mapped = PRISMA_CODE_TO_SQLSTATE[err.code];
    if (mapped) return { sqlState: mapped };
    return fromMessage(err.message);
  }
  if (err instanceof Prisma.PrismaClientUnknownRequestError) {
    return fromMessage(err.message);
  }
  return null;
}

function fromMessage(message: string): { sqlState: string; pgMessage?: string } | null {
  const code = /code: "?`?([0-9A-Z]{5})`?"?/i.exec(message)?.[1];
  if (code) return { sqlState: code.toUpperCase() };
  if (/permission denied|row-level security/i.test(message)) return { sqlState: '42501' };
  return null;
}

/** Traduit une erreur PostgreSQL en réponse HTTP, ou null si elle n'est pas reconnue. */
export function mapPgError(err: unknown): HttpErrorShape | null {
  const pg = extractPgError(err);
  if (!pg) return null;
  const mapping = SQLSTATE_MAP[pg.sqlState];
  if (!mapping) return null;
  return {
    status: mapping.status,
    error: mapping.error,
    message: mapping.message ?? cleanBusinessMessage(pg.pgMessage) ?? mapping.error,
  };
}

// Prisma préfixe parfois le message (« ERROR: … ») : on garde la phrase métier.
function cleanBusinessMessage(message: string | undefined): string | undefined {
  if (!message) return undefined;
  return message.replace(/^ERROR:\s*/i, '').split('\n')[0]?.trim() || undefined;
}
