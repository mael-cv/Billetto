import { severityCounts, type ReportData } from "./report";

/** Rapport JSON machine-lisible. */
export function renderJson(report: ReportData): string {
  return JSON.stringify(
    {
      meta: report.meta,
      summary: {
        severityCounts: severityCounts(report.findings),
        coveragePercent: report.coveragePercent,
        totalFindings: report.findings.length,
      },
      coverage: report.coverage,
      findings: report.findings,
    },
    null,
    2,
  );
}
