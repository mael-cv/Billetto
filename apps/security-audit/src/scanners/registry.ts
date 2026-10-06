/**
 * Adaptateurs de scanners externes OPTIONNELS. Détectés s'ils sont présents,
 * sinon NOT_INSTALLED et on continue. Aucun n'est requis ; aucune clé API.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AuditConfig } from "../core/config";
import type { Category, FindingInput, Severity } from "../core/finding";

const pExecFile = promisify(execFile);

export interface ScannerResult {
  name: string;
  installed: boolean;
  findings: FindingInput[];
  note?: string;
}

const WHICH = process.platform === "win32" ? "where" : "which";

async function isInstalled(bin: string): Promise<boolean> {
  try {
    await pExecFile(WHICH, [bin], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

async function exec(bin: string, args: string[], cwd: string): Promise<{ stdout: string; stderr: string } | undefined> {
  try {
    const { stdout, stderr } = await pExecFile(bin, args, {
      cwd,
      timeout: 180_000,
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
    });
    return { stdout, stderr };
  } catch (e) {
    // Beaucoup de scanners sortent avec un code ≠ 0 quand ils trouvent des findings.
    const err = e as { stdout?: string; stderr?: string };
    if (err.stdout) return { stdout: err.stdout, stderr: err.stderr ?? "" };
    return undefined;
  }
}

export async function runScanner(
  name: "semgrep" | "gitleaks" | "trivy" | "osv-scanner" | "nuclei" | "zap",
  repoRoot: string,
  config: AuditConfig,
): Promise<ScannerResult> {
  const enabled = config.scanners?.[name]?.enabled ?? false;
  if (!enabled) return { name, installed: false, findings: [], note: "désactivé en config" };
  if (!(await isInstalled(name))) return { name, installed: false, findings: [], note: "NOT_INSTALLED" };

  switch (name) {
    case "osv-scanner":
      return parseOsv(await exec("osv-scanner", ["--format", "json", "-r", "."], repoRoot));
    case "trivy":
      return parseTrivy(await exec("trivy", ["fs", "--quiet", "--format", "json", "."], repoRoot));
    case "gitleaks":
      return parseGitleaks(await exec("gitleaks", ["detect", "--no-banner", "--report-format", "json", "--report-path", "-"], repoRoot));
    case "semgrep":
      return parseSemgrep(await exec("semgrep", ["--quiet", "--json", "--config", "auto", "."], repoRoot));
    default:
      return { name, installed: true, findings: [], note: "adaptateur minimal : exécution non implémentée" };
  }

  function wrap(findings: FindingInput[]): ScannerResult {
    return { name, installed: true, findings };
  }

  function parseOsv(out?: { stdout: string }): ScannerResult {
    if (!out) return wrap([]);
    try {
      const data = JSON.parse(out.stdout) as { results?: Array<{ packages?: Array<{ package?: { name?: string }; vulnerabilities?: Array<{ id?: string; summary?: string; database_specific?: { severity?: string } }> }> }> };
      const findings: FindingInput[] = [];
      for (const r of data.results ?? []) {
        for (const p of r.packages ?? []) {
          for (const v of p.vulnerabilities ?? []) {
            findings.push(depFinding(`${v.id ?? "VULN"} dans ${p.package?.name ?? "?"}`, v.summary ?? "", mapSeverity(v.database_specific?.severity), "osv-scanner", v.id));
          }
        }
      }
      return wrap(findings);
    } catch {
      return wrap([]);
    }
  }

  function parseTrivy(out?: { stdout: string }): ScannerResult {
    if (!out) return wrap([]);
    try {
      const data = JSON.parse(out.stdout) as { Results?: Array<{ Vulnerabilities?: Array<{ VulnerabilityID?: string; PkgName?: string; Severity?: string; Title?: string }> }> };
      const findings: FindingInput[] = [];
      for (const r of data.Results ?? []) {
        for (const v of r.Vulnerabilities ?? []) {
          findings.push(depFinding(`${v.VulnerabilityID} dans ${v.PkgName}`, v.Title ?? "", mapSeverity(v.Severity), "trivy", v.VulnerabilityID));
        }
      }
      return wrap(findings);
    } catch {
      return wrap([]);
    }
  }

  function parseGitleaks(out?: { stdout: string }): ScannerResult {
    if (!out) return wrap([]);
    try {
      const data = JSON.parse(out.stdout) as Array<{ RuleID?: string; File?: string; StartLine?: number; Description?: string }>;
      const findings: FindingInput[] = (data ?? []).map((d) => ({
        title: `Secret détecté (${d.RuleID ?? "gitleaks"})`,
        severity: "HIGH" as Severity,
        confidence: 0.7,
        status: "SUSPECTED" as const,
        classification: "REAL_VULNERABILITY" as const,
        category: "secrets" as Category,
        cwe: "CWE-798",
        owasp: "A07:2021-Identification and Authentication Failures",
        source: "scanner:gitleaks" as const,
        location: { file: d.File, line: d.StartLine },
        evidence: [{ snippet: "[REDACTED]", note: d.Description }],
        reproduction: [`gitleaks : ${d.File}:${d.StartLine}`],
        remediation: "Retirer le secret, le faire tourner.",
        retestable: false,
      }));
      return wrap(findings);
    } catch {
      return wrap([]);
    }
  }

  function parseSemgrep(out?: { stdout: string }): ScannerResult {
    if (!out) return wrap([]);
    try {
      const data = JSON.parse(out.stdout) as { results?: Array<{ check_id?: string; path?: string; start?: { line?: number }; extra?: { message?: string; severity?: string } }> };
      const findings: FindingInput[] = (data.results ?? []).map((r) => ({
        title: `SAST (semgrep) : ${r.check_id ?? "règle"}`,
        severity: mapSeverity(r.extra?.severity),
        confidence: 0.6,
        status: "SUSPECTED" as const,
        classification: "REAL_VULNERABILITY" as const,
        category: "sast" as Category,
        source: "scanner:semgrep" as const,
        location: { file: r.path, line: r.start?.line },
        evidence: [{ note: r.extra?.message }],
        reproduction: [`semgrep : ${r.path}:${r.start?.line}`],
        remediation: "Voir la règle semgrep correspondante.",
        retestable: false,
      }));
      return wrap(findings);
    } catch {
      return wrap([]);
    }
  }
}

function depFinding(title: string, summary: string, severity: Severity, scanner: string, ref?: string): FindingInput {
  return {
    title,
    severity,
    confidence: 0.75,
    status: "SUSPECTED",
    classification: "REAL_VULNERABILITY",
    category: "dependencies",
    cwe: "CWE-1395",
    owasp: "A06:2021-Vulnerable and Outdated Components",
    source: `scanner:${scanner}`,
    location: {},
    evidence: [{ note: summary.slice(0, 300) }],
    reproduction: [`${scanner} : ${ref ?? title}`],
    remediation: "Mettre à jour la dépendance vers une version corrigée.",
    references: ref ? [`https://osv.dev/${ref}`] : undefined,
    retestable: false,
  };
}

function mapSeverity(s?: string): Severity {
  switch ((s ?? "").toUpperCase()) {
    case "CRITICAL":
      return "CRITICAL";
    case "HIGH":
    case "ERROR":
      return "HIGH";
    case "MEDIUM":
    case "MODERATE":
    case "WARNING":
      return "MEDIUM";
    case "LOW":
    case "INFO":
      return "LOW";
    default:
      return "MEDIUM";
  }
}

/** Liste l'état d'installation de tous les scanners (pour le rapport de couverture). */
export async function scannerStatus(config: AuditConfig): Promise<Array<{ name: string; installed: boolean }>> {
  const names = ["semgrep", "gitleaks", "trivy", "osv-scanner", "nuclei", "zap"] as const;
  const out: Array<{ name: string; installed: boolean }> = [];
  for (const n of names) {
    const enabled = config.scanners?.[n]?.enabled ?? false;
    out.push({ name: n, installed: enabled ? await isInstalled(n) : false });
  }
  return out;
}
