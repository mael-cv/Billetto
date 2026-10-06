/**
 * Modèle de finding unifié, partagé par tous les moteurs (black-box, white-box,
 * infra, scanners externes, corrélation). Déterministe, sérialisable en JSON.
 */

export type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";

export type FindingStatus =
  | "DISCOVERED"
  | "SUSPECTED"
  | "CONFIRMED"
  | "FALSE_POSITIVE"
  | "DUPLICATE"
  | "NEEDS_REVIEW";

export type Classification =
  | "REAL_VULNERABILITY"
  | "INTENTIONAL_HONEYPOT"
  | "FALSE_POSITIVE";

export type FindingSource =
  | "blackbox"
  | "whitebox"
  | "infra"
  | "correlated"
  | `scanner:${string}`;

/** Catégories (une par check). Sert aussi de clé de couverture. */
export type Category =
  // black-box
  | "discovery"
  | "http-methods"
  | "middleware"
  | "authentication"
  | "bruteforce"
  | "account-enumeration"
  | "authorization"
  | "privilege-escalation"
  | "input-fuzzing"
  | "injection"
  | "xss"
  | "csrf"
  | "cors"
  | "security-headers"
  | "cookies"
  | "session"
  | "jwt"
  | "error-handling"
  | "debug-endpoints"
  | "file-upload"
  | "path-traversal"
  | "ssrf"
  | "open-redirect"
  | "api"
  | "rate-limiting"
  | "resource-exhaustion"
  | "http-desync"
  | "websockets"
  | "timing"
  | "business-logic"
  | "honeypot"
  // white-box
  | "sast"
  | "secrets"
  | "dependencies"
  | "configuration"
  | "docker"
  | "cicd"
  | "infrastructure";

export interface EvidenceItem {
  /** Métadonnées de requête (redactées). Jamais de credential en clair. */
  request?: Record<string, unknown>;
  /** Métadonnées de réponse (status, headers filtrés, taille, latence). */
  response?: Record<string, unknown>;
  /** Extrait de code ou de config (white-box), redacté si nécessaire. */
  snippet?: string;
  note?: string;
}

export interface FindingLocation {
  endpoint?: string;
  method?: string;
  file?: string;
  line?: number;
  param?: string;
}

export interface Finding {
  id: string; // SEC-001...
  title: string;
  severity: Severity;
  confidence: number; // 0..1
  status: FindingStatus;
  classification: Classification;
  category: Category;
  cwe?: string;
  owasp?: string;
  cvss?: number;
  cvssVector?: string;
  source: FindingSource;
  location: FindingLocation;
  evidence: EvidenceItem[];
  reproduction: string[];
  impact?: string;
  remediation?: string;
  references?: string[];
  retestable: boolean;
  /** Données opaques permettant au check de rejouer le finding (--retest). */
  retest?: { checkId: string; params?: Record<string, unknown> };
  firstSeen?: string; // timestamp injecté par le runtime (hors workflow)
}

/** Entrée de finding avant attribution d'un id / statut final. */
export type FindingInput = Omit<Finding, "id" | "firstSeen"> &
  Partial<Pick<Finding, "id" | "firstSeen">>;

let seq = 0;
/** Réinitialise la numérotation (utile entre runs/tests). */
export function resetFindingIds(start = 0): void {
  seq = start;
}

export function makeFindingId(): string {
  seq += 1;
  return `SEC-${String(seq).padStart(3, "0")}`;
}

/** Normalise une entrée en Finding complet (id, defaults). */
export function toFinding(input: FindingInput): Finding {
  return {
    id: input.id ?? makeFindingId(),
    title: input.title,
    severity: input.severity,
    confidence: clamp01(input.confidence),
    status: input.status,
    classification: input.classification ?? "REAL_VULNERABILITY",
    category: input.category,
    cwe: input.cwe,
    owasp: input.owasp,
    cvss: input.cvss,
    cvssVector: input.cvssVector,
    source: input.source,
    location: input.location ?? {},
    evidence: input.evidence ?? [],
    reproduction: input.reproduction ?? [],
    impact: input.impact,
    remediation: input.remediation,
    references: input.references,
    retestable: input.retestable ?? false,
    retest: input.retest,
    firstSeen: input.firstSeen,
  };
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

export const SEVERITY_ORDER: Record<Severity, number> = {
  CRITICAL: 5,
  HIGH: 4,
  MEDIUM: 3,
  LOW: 2,
  INFO: 1,
};

export function compareSeverity(a: Severity, b: Severity): number {
  return SEVERITY_ORDER[b] - SEVERITY_ORDER[a];
}
