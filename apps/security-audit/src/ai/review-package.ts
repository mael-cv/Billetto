/**
 * Génère un « AI Review Package » : un dossier autoportant à fournir MANUELLEMENT
 * à Claude Code / Codex / Mistral (abonnements, pas de crédits API) pour une revue
 * approfondie. N'appelle aucune API. 100 % offline.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ReportData } from "../reporting/report";

export function generateAiReviewPackage(report: ReportData, outDir: string): string {
  const dir = join(outDir, "ai-review");
  mkdirSync(join(dir, "prompts"), { recursive: true });

  writeFileSync(join(dir, "findings.json"), JSON.stringify(report.findings, null, 2), "utf8");
  writeFileSync(join(dir, "coverage.json"), JSON.stringify(report.coverage, null, 2), "utf8");

  const sourceMap = report.findings
    .filter((f) => f.location.file)
    .map((f) => ({ id: f.id, file: f.location.file, line: f.location.line, cwe: f.cwe }));
  writeFileSync(join(dir, "source-map.json"), JSON.stringify(sourceMap, null, 2), "utf8");

  writeFileSync(join(dir, "context.md"), contextMd(report), "utf8");
  writeFileSync(join(dir, "prompts", "attacker.md"), ATTACKER_PROMPT, "utf8");
  writeFileSync(join(dir, "prompts", "defender.md"), DEFENDER_PROMPT, "utf8");
  writeFileSync(join(dir, "prompts", "judge.md"), JUDGE_PROMPT, "utf8");

  return dir;
}

function contextMd(report: ReportData): string {
  return [
    "# AI Review Package — security-audit",
    "",
    `Cible : ${report.meta.baseUrl} · profil ${report.meta.profile} · ${report.meta.timestamp}`,
    `Couverture : ${report.coveragePercent}% · ${report.findings.length} findings.`,
    "",
    "Ce paquet est destiné à une revue MANUELLE par un agent (Claude Code / Codex / Mistral).",
    "Aucune clé API n'est requise : copiez `findings.json`, `source-map.json` et `context.md`",
    "dans votre agent et utilisez les prompts de `prompts/` (protocole contradictoire).",
    "",
    "## Protocole contradictoire",
    "1. **Attacker** argumente l'exploitabilité de chaque finding.",
    "2. **Defender** tente de le réfuter.",
    "3. **Judge** tranche (réel / faux positif / à revoir).",
    "",
    "Les rôles Code Reviewer / Pentester / Business Logic Reviewer peuvent compléter l'analyse.",
  ].join("\n");
}

const ATTACKER_PROMPT = `Tu es un pentester (rôle Attacker). Pour chaque finding de findings.json,
argumente de façon concrète comment il serait exploité (préconditions, étapes, impact).
Si tu ne peux pas construire d'exploitation plausible, dis-le.`;

const DEFENDER_PROMPT = `Tu es l'ingénieur défenseur (rôle Defender). Pour chaque finding,
tente de réfuter l'exploitabilité avancée par l'Attacker (contrôles existants, contexte,
faux positif probable). Appuie-toi sur source-map.json et le code réel.`;

const JUDGE_PROMPT = `Tu es le juge (rôle Judge). À partir des arguments Attacker/Defender,
classe chaque finding : REAL_VULNERABILITY / FALSE_POSITIVE / NEEDS_REVIEW, avec une
justification courte et une sévérité révisée si nécessaire.`;
