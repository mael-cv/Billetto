import { compareSeverity, type Finding } from "../core/finding";
import { realFindings, severityCounts, SEVERITIES, type ReportData } from "./report";

/** Rapport Markdown lisible (executive summary + couverture + findings). */
export function renderMarkdown(report: ReportData): string {
  const counts = severityCounts(report.findings);
  const real = realFindings(report.findings).sort((a, b) => compareSeverity(a.severity, b.severity));
  const honeypots = report.findings.filter((f) => f.classification === "INTENTIONAL_HONEYPOT");
  const l: string[] = [];

  l.push("# Rapport security-audit", "");
  l.push(`- **Cible** : ${report.meta.baseUrl} (${report.meta.appReachable ? "joignable" : "NON joignable"})`);
  l.push(`- **Profil** : ${report.meta.profile}`);
  l.push(`- **Date** : ${report.meta.timestamp}`);
  l.push(`- **Requêtes émises** : ${report.meta.requestsMade}`);
  l.push("");

  l.push("## Executive summary", "");
  l.push("| Sévérité | Nombre |", "|---|---|");
  for (const s of SEVERITIES) l.push(`| ${s} | ${counts[s]} |`);
  l.push("");
  if (real.length === 0) {
    l.push("> **No confirmed vulnerabilities found among tested controls.**", "");
  }
  l.push(`**Couverture : ${report.coveragePercent}%**`, "");

  l.push("## Couverture par catégorie", "");
  l.push("| Catégorie | Statut | Note |", "|---|---|---|");
  for (const c of report.coverage) {
    l.push(`| ${c.category} | ${c.status} | ${c.note ?? ""} |`);
  }
  l.push("");

  l.push("## Findings", "");
  if (real.length === 0) {
    l.push("_Aucune vulnérabilité réelle confirmée parmi les contrôles testés._", "");
  }
  for (const f of real) {
    l.push(renderFinding(f));
  }

  if (honeypots.length > 0) {
    l.push("## Honeypots (intentionnels, hors décompte)", "");
    for (const f of honeypots) l.push(`- ${f.id} — ${f.title} (${f.location.endpoint ?? f.location.file ?? ""})`);
    l.push("");
  }

  l.push("## Scanners externes", "");
  for (const s of report.meta.scanners) {
    l.push(`- ${s.name} : ${s.installed ? "disponible" : "NOT_INSTALLED"}`);
  }
  l.push("");

  return l.join("\n");
}

function renderFinding(f: Finding): string {
  const loc = f.location.endpoint
    ? `${f.location.method ?? ""} ${f.location.endpoint}`
    : f.location.file
      ? `${f.location.file}:${f.location.line ?? ""}`
      : "—";
  const lines = [
    `### ${f.id} — ${f.title}`,
    "",
    `- **Sévérité** : ${f.severity}${f.cvss ? ` (CVSS ${f.cvss})` : ""} · **Confiance** : ${(f.confidence * 100).toFixed(0)}% · **Statut** : ${f.status}`,
    `- **Catégorie** : ${f.category} · **Source** : ${f.source}${f.cwe ? ` · ${f.cwe}` : ""}${f.owasp ? ` · ${f.owasp}` : ""}`,
    `- **Localisation** : ${loc}`,
  ];
  if (f.impact) lines.push(`- **Impact** : ${f.impact}`);
  if (f.remediation) lines.push(`- **Remédiation** : ${f.remediation}`);
  if (f.reproduction.length) {
    lines.push("- **Reproduction** :");
    for (const step of f.reproduction) lines.push(`  1. ${step}`);
  }
  if (f.retestable) lines.push(`- **Retest** : \`security-audit --retest ${f.id}\``);
  lines.push("");
  return lines.join("\n");
}
