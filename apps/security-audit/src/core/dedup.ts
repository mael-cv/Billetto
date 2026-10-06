/**
 * Déduplication des findings. Clé = catégorie | endpoint|méthode | fichier:ligne | CWE.
 * Deux findings identiques → on garde le plus confiant/sévère, on fusionne les preuves.
 */

import { compareSeverity, type Finding } from "./finding";

export function findingKey(f: Finding): string {
  const loc = f.location;
  const where =
    loc.endpoint && loc.method
      ? `${loc.method} ${loc.endpoint}${loc.param ? `#${loc.param}` : ""}`
      : loc.file
        ? `${loc.file}:${loc.line ?? 0}`
        : f.title;
  return [f.category, where, f.cwe ?? ""].join("|");
}

export function dedupe(findings: Finding[]): Finding[] {
  const byKey = new Map<string, Finding>();
  for (const f of findings) {
    const key = findingKey(f);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, f);
      continue;
    }
    byKey.set(key, merge(existing, f));
  }
  return [...byKey.values()];
}

function merge(a: Finding, b: Finding): Finding {
  // Le gagnant : sévérité la plus haute, puis confiance la plus haute.
  const sev = compareSeverity(a.severity, b.severity);
  const winner = sev < 0 ? a : sev > 0 ? b : a.confidence >= b.confidence ? a : b;
  const loser = winner === a ? b : a;
  return {
    ...winner,
    confidence: Math.max(a.confidence, b.confidence),
    evidence: [...winner.evidence, ...loser.evidence],
    reproduction:
      winner.reproduction.length >= loser.reproduction.length
        ? winner.reproduction
        : loser.reproduction,
    // Si les deux sources diffèrent, on marque la provenance comme corrélée.
    source: a.source === b.source ? winner.source : "correlated",
    status: upgradeStatus(a, b),
  };
}

function upgradeStatus(a: Finding, b: Finding): Finding["status"] {
  // Confirmé par deux sources → CONFIRMED.
  if (a.source !== b.source && (a.status === "CONFIRMED" || b.status === "CONFIRMED")) {
    return "CONFIRMED";
  }
  return a.status === "CONFIRMED" || b.status === "CONFIRMED"
    ? "CONFIRMED"
    : a.status;
}
