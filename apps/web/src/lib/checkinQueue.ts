// File locale des scans de check-in (offline-first).
//
// Chaque scan reçoit un clientScanId (UUID) au moment du scan : c'est la clé
// d'idempotence côté serveur (billets_scans.client_scan_id UNIQUE). Un scan
// peut donc être renvoyé autant de fois que nécessaire (réseau coupé,
// réponse perdue, onglet rechargé) sans jamais créer de doublon.
//
// localStorage peut être indisponible (navigation privée, quota) : toutes les
// lectures/écritures sont protégées, la file vit alors seulement en mémoire.
import type { CheckinManifestEntry } from "./types";

export interface PendingScan {
  clientScanId: string;
  payload: string;
  evenementId: number;
  scanneA: string;
  appareil?: string;
}

/** Verdict immédiat, calculé localement à partir du manifeste. Le serveur tranche. */
export type LocalVerdict = "ok_provisoire" | "doublon_local" | "inconnu";

const key = (evenementId: number) => `billetto:checkin:${evenementId}`;

interface Stored {
  pending: PendingScan[];
  /** Signatures déjà validées sur cet appareil (provisoirement ou par le serveur). */
  scanned: string[];
}

const memory = new Map<number, Stored>();

export function load(evenementId: number): Stored {
  try {
    const raw = localStorage.getItem(key(evenementId));
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Stored>;
      const stored = { pending: parsed.pending ?? [], scanned: parsed.scanned ?? [] };
      memory.set(evenementId, stored);
      return stored;
    }
  } catch {
    // stockage indisponible : on retombe sur la mémoire
  }
  return memory.get(evenementId) ?? { pending: [], scanned: [] };
}

function save(evenementId: number, stored: Stored): void {
  memory.set(evenementId, stored);
  try {
    localStorage.setItem(key(evenementId), JSON.stringify(stored));
  } catch {
    // idem : la file reste en mémoire pour cette session
  }
}

/** Signature HMAC contenue dans un QR BT1.<code>.<signature>, ou null si le format est inconnu. */
export function signatureOf(payload: string): string | null {
  const match = /^BT1\.[0-9a-fA-F-]{36}\.([A-Za-z0-9_-]{22})$/.exec(payload.trim());
  return match?.[1] ?? null;
}

/**
 * Verdict local, sans réseau : le QR doit figurer dans le manifeste et ne pas
 * avoir déjà été validé (manifeste ou cet appareil). Un QR inconnu peut être
 * un billet acheté après le téléchargement du manifeste : seul le serveur
 * décide.
 */
export function localVerdict(
  payload: string,
  manifest: Map<string, CheckinManifestEntry>,
  scanned: ReadonlySet<string>,
): LocalVerdict {
  const signature = signatureOf(payload);
  const entry = signature ? manifest.get(signature) : undefined;
  if (!signature || !entry) return "inconnu";
  if (entry.dejaScanne || scanned.has(signature)) return "doublon_local";
  return "ok_provisoire";
}

/** Enregistre un scan dans la file (avant tout envoi) et renvoie l'entrée créée. */
export function enqueue(evenementId: number, payload: string, appareil?: string, now = new Date()): PendingScan {
  const stored = load(evenementId);
  const scan: PendingScan = {
    clientScanId: crypto.randomUUID(),
    payload: payload.trim(),
    evenementId,
    scanneA: now.toISOString(),
    appareil,
  };
  const signature = signatureOf(scan.payload);
  save(evenementId, {
    pending: [...stored.pending, scan],
    scanned: signature && !stored.scanned.includes(signature) ? [...stored.scanned, signature] : stored.scanned,
  });
  return scan;
}

/** Retire de la file les scans acquittés par le serveur (résultat reçu, quel qu'il soit). */
export function acknowledge(evenementId: number, clientScanIds: Iterable<string>): void {
  const done = new Set(clientScanIds);
  const stored = load(evenementId);
  save(evenementId, { ...stored, pending: stored.pending.filter((s) => !done.has(s.clientScanId)) });
}

export function pending(evenementId: number): PendingScan[] {
  return load(evenementId).pending;
}

export function scannedSignatures(evenementId: number): Set<string> {
  return new Set(load(evenementId).scanned);
}
