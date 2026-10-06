/**
 * Scoring CVSS v3.1 (base) déterministe + mapping severity.
 * On re-score toujours dans notre barème ; on ne reprend jamais aveuglément la
 * note d'un scanner tiers. L'absence d'un header n'est pas HIGH par défaut.
 */

import type { Severity } from "./finding";

export interface Cvss31Base {
  AV: "N" | "A" | "L" | "P"; // Attack Vector
  AC: "L" | "H"; // Attack Complexity
  PR: "N" | "L" | "H"; // Privileges Required
  UI: "N" | "R"; // User Interaction
  S: "U" | "C"; // Scope
  C: "N" | "L" | "H"; // Confidentiality
  I: "N" | "L" | "H"; // Integrity
  A: "N" | "L" | "H"; // Availability
}

const AV_W = { N: 0.85, A: 0.62, L: 0.55, P: 0.2 };
const AC_W = { L: 0.77, H: 0.44 };
const UI_W = { N: 0.85, R: 0.62 };
const CIA_W = { N: 0, L: 0.22, H: 0.56 };
const PR_W_UNCHANGED = { N: 0.85, L: 0.62, H: 0.27 };
const PR_W_CHANGED = { N: 0.85, L: 0.68, H: 0.5 };

function roundUp1(n: number): number {
  return Math.ceil(n * 10) / 10;
}

export function cvss31Score(m: Cvss31Base): number {
  const iss = 1 - (1 - CIA_W[m.C]) * (1 - CIA_W[m.I]) * (1 - CIA_W[m.A]);
  const impact =
    m.S === "U"
      ? 6.42 * iss
      : 7.52 * (iss - 0.029) - 3.25 * Math.pow(iss - 0.02, 15);
  const prW = m.S === "C" ? PR_W_CHANGED[m.PR] : PR_W_UNCHANGED[m.PR];
  const exploitability = 8.22 * AV_W[m.AV] * AC_W[m.AC] * prW * UI_W[m.UI];
  if (impact <= 0) return 0;
  const base =
    m.S === "U"
      ? Math.min(impact + exploitability, 10)
      : Math.min(1.08 * (impact + exploitability), 10);
  return roundUp1(base);
}

export function cvssVector(m: Cvss31Base): string {
  return `CVSS:3.1/AV:${m.AV}/AC:${m.AC}/PR:${m.PR}/UI:${m.UI}/S:${m.S}/C:${m.C}/I:${m.I}/A:${m.A}`;
}

export function severityFromScore(score: number): Severity {
  if (score >= 9.0) return "CRITICAL";
  if (score >= 7.0) return "HIGH";
  if (score >= 4.0) return "MEDIUM";
  if (score > 0.0) return "LOW";
  return "INFO";
}

export interface ScoreResult {
  cvss: number;
  cvssVector: string;
  severity: Severity;
}

export function score(metrics: Cvss31Base): ScoreResult {
  const cvss = cvss31Score(metrics);
  return {
    cvss,
    cvssVector: cvssVector(metrics),
    severity: severityFromScore(cvss),
  };
}

/** Vecteurs réutilisables, nommés par type de faille (base ; ajustable au besoin). */
export const VECTORS = {
  // Broken access control, données lisibles par un autre utilisateur.
  bolaRead: { AV: "N", AC: "L", PR: "L", UI: "N", S: "U", C: "H", I: "N", A: "N" } as Cvss31Base,
  // Broken access control avec écriture (refund/confirm d'autrui).
  bolaWrite: { AV: "N", AC: "L", PR: "L", UI: "N", S: "U", C: "H", I: "H", A: "N" } as Cvss31Base,
  // Élévation de privilège verticale.
  privEsc: { AV: "N", AC: "L", PR: "L", UI: "N", S: "C", C: "H", I: "H", A: "N" } as Cvss31Base,
  // Injection SQL confirmée.
  sqli: { AV: "N", AC: "L", PR: "N", UI: "N", S: "U", C: "H", I: "H", A: "N" } as Cvss31Base,
  // Reflected XSS.
  reflectedXss: { AV: "N", AC: "L", PR: "N", UI: "R", S: "C", C: "L", I: "L", A: "N" } as Cvss31Base,
  // Mauvaise CORS (reflect + credentials).
  badCors: { AV: "N", AC: "L", PR: "N", UI: "R", S: "C", C: "H", I: "N", A: "N" } as Cvss31Base,
  // SSRF confirmé.
  ssrf: { AV: "N", AC: "L", PR: "L", UI: "N", S: "C", C: "H", I: "L", A: "N" } as Cvss31Base,
  // Absence de rate limit sur l'auth (brute force possible).
  noRateLimit: { AV: "N", AC: "L", PR: "N", UI: "N", S: "U", C: "L", I: "N", A: "N" } as Cvss31Base,
  // Fuite d'information (verbose error, account enumeration).
  infoLeak: { AV: "N", AC: "L", PR: "N", UI: "N", S: "U", C: "L", I: "N", A: "N" } as Cvss31Base,
  // Open redirect.
  openRedirect: { AV: "N", AC: "L", PR: "N", UI: "R", S: "C", C: "L", I: "L", A: "N" } as Cvss31Base,
  // Mass assignment vers champ sensible.
  massAssignment: { AV: "N", AC: "L", PR: "L", UI: "N", S: "U", C: "L", I: "H", A: "N" } as Cvss31Base,
  // Cookie faible (pas HttpOnly/Secure).
  weakCookie: { AV: "N", AC: "H", PR: "N", UI: "R", S: "U", C: "L", I: "N", A: "N" } as Cvss31Base,
  // En-tête de sécurité manquant (jamais HIGH par défaut).
  missingHeader: { AV: "N", AC: "H", PR: "N", UI: "R", S: "U", C: "L", I: "N", A: "N" } as Cvss31Base,
  // CSRF sur opération mutante.
  csrf: { AV: "N", AC: "L", PR: "N", UI: "R", S: "U", C: "N", I: "H", A: "N" } as Cvss31Base,
  // Divulgation de version / bannière.
  versionDisclosure: { AV: "N", AC: "L", PR: "N", UI: "N", S: "U", C: "L", I: "N", A: "N" } as Cvss31Base,
  // JWT mal validé (alg:none accepté).
  jwtWeak: { AV: "N", AC: "L", PR: "N", UI: "N", S: "C", C: "H", I: "H", A: "N" } as Cvss31Base,
} satisfies Record<string, Cvss31Base>;
