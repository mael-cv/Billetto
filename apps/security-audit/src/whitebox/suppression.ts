import type { FindingInput } from "../core/finding";

/**
 * Suppression justifiée d'un finding white-box (SAST, secrets), par marqueur
 * inline sur la ligne signalée ou sur la ligne qui la précède :
 *
 *   // security-audit-ignore: child-process -- spawnSync avec argv, aucune entrée externe
 *
 * Plusieurs règles possibles (`rule-a, rule-b`). La raison après `--` est
 * OBLIGATOIRE : sans elle, le finding est conservé et un INFO signale la
 * suppression non justifiée. Un finding supprimé reste dans le rapport
 * (FALSE_POSITIVE + justification) mais sort des compteurs et du gate.
 */
const MARKER = /security-audit-ignore:\s*([a-z0-9-]+(?:\s*,\s*[a-z0-9-]+)*)(?:\s*--\s*(.*\S))?/i;

export type SuppressionMatch =
  | { kind: "justified"; reason: string; line: number }
  | { kind: "unjustified"; line: number };

/** Cherche un marqueur visant `ruleId` sur la ligne `index` (0-based) ou la précédente. */
export function findSuppression(lines: string[], index: number, ruleId: string): SuppressionMatch | undefined {
  for (const i of [index, index - 1]) {
    const m = MARKER.exec(lines[i] ?? "");
    if (!m) continue;
    const rules = (m[1] ?? "").split(",").map((r) => r.trim().toLowerCase());
    if (!rules.includes(ruleId.toLowerCase())) continue;
    const reason = (m[2] ?? "").replace(/\s*(\*\/|-->)\s*$/, "").trim();
    return reason ? { kind: "justified", reason, line: i + 1 } : { kind: "unjustified", line: i + 1 };
  }
  return undefined;
}

/**
 * Applique la suppression éventuelle à un finding. Retourne les findings à
 * émettre : le finding (marqué FALSE_POSITIVE si justifié) et, si le marqueur
 * n'a pas de raison, un INFO « suppression non justifiée ».
 */
export function applySuppression(
  finding: FindingInput,
  lines: string[],
  index: number,
  ruleId: string,
  file: string,
): FindingInput[] {
  const match = findSuppression(lines, index, ruleId);
  if (!match) return [finding];
  if (match.kind === "justified") {
    return [
      {
        ...finding,
        status: "FALSE_POSITIVE",
        classification: "FALSE_POSITIVE",
        evidence: [...finding.evidence, { note: `supprimé (${file}:${match.line}) : ${match.reason}` }],
      },
    ];
  }
  return [
    finding,
    {
      title: "Suppression security-audit-ignore sans justification",
      severity: "INFO",
      confidence: 1,
      status: "CONFIRMED",
      classification: "REAL_VULNERABILITY",
      category: finding.category,
      source: finding.source,
      location: { file, line: match.line },
      evidence: [{ note: `marqueur pour ${ruleId} sans raison après « -- »` }],
      reproduction: [`${file}:${match.line} — security-audit-ignore: ${ruleId} (raison manquante)`],
      remediation: "Ajouter la justification : `security-audit-ignore: <règle> -- <raison>`.",
      retestable: false,
    },
  ];
}
