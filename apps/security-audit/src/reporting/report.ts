/** Structure agrégée consommée par tous les reporters. */

import type { Finding, Severity } from "../core/finding";
import type { CoverageEntry } from "../core/coverage";

export interface ReportMeta {
  timestamp: string;
  baseUrl: string;
  profile: string;
  repoRoot?: string;
  requestsMade: number;
  scanners: Array<{ name: string; installed: boolean }>;
  appReachable: boolean;
}

export interface ReportData {
  meta: ReportMeta;
  findings: Finding[];
  coverage: CoverageEntry[];
  coveragePercent: number;
}

export const SEVERITIES: Severity[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"];

/** Compte les findings réels (hors honeypot/false positive) par sévérité. */
export function severityCounts(findings: Finding[]): Record<Severity, number> {
  const acc: Record<Severity, number> = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 };
  for (const f of realFindings(findings)) acc[f.severity] += 1;
  return acc;
}

export function realFindings(findings: Finding[]): Finding[] {
  return findings.filter((f) => f.classification === "REAL_VULNERABILITY" && f.status !== "FALSE_POSITIVE");
}
