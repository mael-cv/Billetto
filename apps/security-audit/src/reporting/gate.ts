/** Évaluation du security gate → code de sortie. N'évalue que les vulnérabilités réelles. */

import type { AuditConfig } from "../core/config";
import type { Severity } from "../core/finding";
import { ExitCode, type ExitCodeValue } from "../core/exit-codes";
import { severityCounts, type ReportData } from "./report";

export interface GateResult {
  passed: boolean;
  exitCode: ExitCodeValue;
  reasons: string[];
}

export function evaluateGate(report: ReportData, config: AuditConfig): GateResult {
  const counts = severityCounts(report.findings);
  const failOn = new Set((config.security_gate?.fail_on ?? []).map((s) => s.toUpperCase() as Severity));
  const reasons: string[] = [];

  for (const sev of failOn) {
    if ((counts[sev] ?? 0) > 0) {
      reasons.push(`${counts[sev]} finding(s) ${sev}`);
    }
  }
  const maxMedium = config.security_gate?.max_medium ?? Infinity;
  if (counts.MEDIUM > maxMedium) {
    reasons.push(`${counts.MEDIUM} findings MEDIUM > max_medium (${maxMedium})`);
  }

  const passed = reasons.length === 0;
  return {
    passed,
    exitCode: passed ? ExitCode.SUCCESS : ExitCode.GATE_FAILED,
    reasons,
  };
}
