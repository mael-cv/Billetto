import { appendFileSync } from "node:fs";
import { severityCounts, realFindings, SEVERITIES, type ReportData } from "./report";
import type { GateResult } from "./gate";
import { compareSeverity } from "../core/finding";

/** Écrit un résumé dans $GITHUB_STEP_SUMMARY (si présent). */
export function writeGithubSummary(report: ReportData, gate: GateResult): void {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  appendFileSync(file, renderGithubSummary(report, gate), "utf8");
}

export function renderGithubSummary(report: ReportData, gate: GateResult): string {
  const counts = severityCounts(report.findings);
  const real = realFindings(report.findings).sort((a, b) => compareSeverity(a.severity, b.severity));
  const top = real.slice(0, 10);
  const l: string[] = [];
  l.push(`## 🛡️ security-audit — ${report.meta.profile}`, "");
  l.push(`Cible : \`${report.meta.baseUrl}\` · Couverture : **${report.coveragePercent}%** · Gate : ${gate.passed ? "✅ PASS" : "❌ FAIL"}`, "");
  l.push("| " + SEVERITIES.join(" | ") + " |");
  l.push("|" + SEVERITIES.map(() => "---").join("|") + "|");
  l.push("| " + SEVERITIES.map((s) => counts[s]).join(" | ") + " |", "");
  if (!gate.passed) l.push(`**Gate échoué :** ${gate.reasons.join(" ; ")}`, "");
  if (top.length) {
    l.push("### Top findings", "");
    for (const f of top) l.push(`- **${f.severity}** ${f.title} (${f.location.endpoint ?? f.location.file ?? ""})`);
  } else {
    l.push("_No confirmed vulnerabilities found among tested controls._");
  }
  l.push("");
  return l.join("\n");
}
