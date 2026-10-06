import type { Tx } from '../../../common/database/db-context.service';

export type ScanResult = 'ok' | 'doublon' | 'invalide' | 'annule' | 'mauvais_evenement';

export interface ScanInput {
  /** Généré par le téléphone : rend les rejeux offline idempotents. */
  clientScanId: string;
  payload: string;
  evenementId: number;
  scanneA: Date;
  appareil?: string;
}

export interface ScanOutcome {
  scanId: number;
  clientScanId: string;
  resultat: ScanResult;
  /** true si ce client_scan_id avait déjà été reçu : réponse d'origine, rien d'écrit. */
  rejeu: boolean;
  billetId: number | null;
  tarif: string | null;
  titulaire: string | null;
  scanneA: Date;
  recuA: Date;
  /** Doublon : le scan qui a validé le billet. */
  premierScan: { scanneA: Date; recuA: Date; appareil: string | null } | null;
}

/** Résultat d'un scan d'un lot : soit un résultat, soit une erreur métier pour ce scan seul. */
export type BatchItem =
  | ({ status: 'done' } & ScanOutcome)
  | { status: 'error'; clientScanId: string; error: string; message: string };

export interface ManifestEntry {
  billetId: number;
  /** Signature imprimée dans le QR : permet une validation provisoire hors ligne. */
  codeVerification: string;
  tarif: string;
  titulaire: string;
  dejaScanne: boolean;
  scanneA: Date | null;
}

export interface CheckinRepository {
  /** Rôle organisateur ou admin ; contrôle d'accès refait par scanner_billet. */
  scan(tx: Tx, input: ScanInput): Promise<ScanOutcome>;
  manifest(tx: Tx, evenementId: number): Promise<ManifestEntry[]>;
}

export const CHECKIN_REPOSITORY = Symbol('CHECKIN_REPOSITORY');
