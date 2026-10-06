/**
 * TARGET SAFETY — barrière obligatoire avant tout test actif.
 * Refuse par défaut toute cible qui n'est pas explicitement autorisée.
 *  1. parse l'URL
 *  2. résout le hostname (DNS) et vérifie que toutes les IP sont locales/autorisées
 *  3. refuse les cibles externes et ambiguës
 *  4. fournit un garde pour refuser les redirects sortants
 *  5. journalise la cible effective
 */

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export interface TargetSafetyOptions {
  allowedHosts: string[];
  /** Si true, exige que les IP résolues soient dans des plages privées/loopback. */
  requirePrivateIp?: boolean;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

export class TargetSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TargetSafetyError";
  }
}

export interface EffectiveTarget {
  url: URL;
  hostname: string;
  resolvedIps: string[];
}

function normalizeHost(h: string): string {
  return h.toLowerCase().replace(/^\[|\]$/g, "");
}

export function isPrivateOrLoopback(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number) as [number, number, number, number];
    if (a === 127) return true; // loopback
    if (a === 10) return true; // 10/8
    if (a === 192 && b === 168) return true; // 192.168/16
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
    if (a === 169 && b === 254) return true; // link-local
    return false;
  }
  if (v === 6) {
    const low = ip.toLowerCase();
    if (low === "::1") return true; // loopback
    if (low.startsWith("fe80")) return true; // link-local
    if (low.startsWith("fc") || low.startsWith("fd")) return true; // ULA
    if (low.startsWith("::ffff:")) return isPrivateOrLoopback(low.slice(7));
    return false;
  }
  return false;
}

/** Vérifie un hostname (sans résolution) : est-il dans l'allowlist ? */
export function hostAllowed(hostname: string, allowedHosts: string[]): boolean {
  const h = normalizeHost(hostname);
  const allow = allowedHosts.map(normalizeHost);
  return allow.includes(h) || LOOPBACK_HOSTS.has(h);
}

/**
 * Valide une cible. Lève TargetSafetyError si elle n'est pas autorisée.
 * Retourne la cible effective (avec IP résolues) si OK.
 */
export async function assertSafeTarget(
  rawUrl: string,
  opts: TargetSafetyOptions,
): Promise<EffectiveTarget> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new TargetSafetyError(`URL de cible invalide : ${rawUrl}`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TargetSafetyError(`Protocole non autorisé : ${url.protocol}`);
  }

  const hostname = normalizeHost(url.hostname);
  if (!hostname) {
    throw new TargetSafetyError("Hostname de cible manquant.");
  }

  if (!hostAllowed(hostname, opts.allowedHosts)) {
    throw new TargetSafetyError(
      `Cible refusée : « ${hostname} » n'est pas dans allowed_hosts (${opts.allowedHosts.join(", ")}).`,
    );
  }

  // Résolution DNS : même si le host est dans l'allowlist, on vérifie que la
  // résolution ne pointe pas vers une IP externe (DNS rebinding).
  let resolvedIps: string[];
  if (isIP(hostname)) {
    resolvedIps = [hostname];
  } else {
    try {
      const results = await lookup(hostname, { all: true });
      resolvedIps = results.map((r) => r.address);
    } catch {
      throw new TargetSafetyError(`Résolution DNS impossible pour « ${hostname} ».`);
    }
  }

  if (resolvedIps.length === 0) {
    throw new TargetSafetyError(`Aucune IP résolue pour « ${hostname} ».`);
  }

  const requirePrivate = opts.requirePrivateIp ?? true;
  if (requirePrivate) {
    const external = resolvedIps.filter((ip) => !isPrivateOrLoopback(ip));
    if (external.length > 0) {
      throw new TargetSafetyError(
        `Cible refusée : « ${hostname} » résout vers des IP non locales (${external.join(", ")}).`,
      );
    }
  }

  return { url, hostname, resolvedIps };
}

/**
 * Garde pour les redirects : une Location ne doit jamais sortir de l'allowlist.
 * Retourne l'URL absolue sûre, ou lève si elle sort de la cible autorisée.
 */
export function assertSafeRedirect(
  location: string,
  base: URL,
  allowedHosts: string[],
): URL {
  let dest: URL;
  try {
    dest = new URL(location, base);
  } catch {
    throw new TargetSafetyError(`Redirect avec Location invalide : ${location}`);
  }
  if (!hostAllowed(dest.hostname, allowedHosts)) {
    throw new TargetSafetyError(
      `Redirect sortant bloqué : ${dest.hostname} hors allowed_hosts.`,
    );
  }
  return dest;
}
