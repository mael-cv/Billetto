import { join, relative } from "node:path";
import type { WhiteboxCheck, WhiteboxContext, CheckResult } from "../../core/check";
import type { FindingInput } from "../../core/finding";
import { walkFiles, readFileSafe } from "../fs-util";
import { runScanner } from "../../scanners/registry";
import { score, VECTORS } from "../../core/score";

/**
 * Supply chain : manifestes + lockfile. Détecte des incohérences déterministes
 * (version du package manager), et délègue l'analyse de vulnérabilités connues à
 * OSV-Scanner / Trivy / `pnpm audit` s'ils sont installés (sinon NOT_INSTALLED).
 */
export const dependenciesCheck: WhiteboxCheck = {
  id: "dependencies",
  category: "dependencies",
  title: "Dépendances / supply chain",
  applies: () => true,
  async run(ctx: WhiteboxContext): Promise<CheckResult> {
    const findings: FindingInput[] = [];

    // 1. Incohérence de version d'outillage (package.json vs .mise.toml).
    const rootPkg = readJson(join(ctx.repoRoot, "package.json"));
    const mise = readFileSafe(join(ctx.repoRoot, ".mise.toml"));
    const pmField = typeof rootPkg?.packageManager === "string" ? rootPkg.packageManager : undefined;
    const pmVersion = pmField?.match(/pnpm@([\d.]+)/)?.[1];
    const miseVersion = mise?.match(/pnpm["'\s]*=\s*["']([\d.]+)["']/)?.[1];
    if (pmVersion && miseVersion && pmVersion !== miseVersion) {
      const s = score({ ...VECTORS.infoLeak, C: "N", I: "L" });
      findings.push({
        title: `Version de pnpm incohérente (package.json ${pmVersion} vs .mise.toml ${miseVersion})`,
        severity: "LOW",
        confidence: 0.9,
        status: "CONFIRMED",
        classification: "REAL_VULNERABILITY",
        category: "dependencies",
        cwe: "CWE-1104",
        owasp: "A06:2021-Vulnerable and Outdated Components",
        cvss: s.cvss,
        cvssVector: s.cvssVector,
        source: "whitebox",
        location: { file: "package.json" },
        evidence: [{ snippet: `packageManager=${pmVersion} ; .mise.toml pnpm=${miseVersion}` }],
        reproduction: ["comparer packageManager (package.json) et pnpm (.mise.toml)"],
        remediation: "Aligner la version du package manager pour des builds reproductibles.",
        retestable: false,
      });
    }

    // 2. Lockfile présent ?
    const hasLock = !!readFileSafe(join(ctx.repoRoot, "pnpm-lock.yaml"));
    if (!hasLock) {
      findings.push({
        title: "Lockfile pnpm absent (builds non reproductibles)",
        severity: "LOW",
        confidence: 0.9,
        status: "CONFIRMED",
        classification: "REAL_VULNERABILITY",
        category: "dependencies",
        cwe: "CWE-1104",
        owasp: "A06:2021-Vulnerable and Outdated Components",
        source: "whitebox",
        location: {},
        evidence: [{ note: "pnpm-lock.yaml introuvable" }],
        reproduction: ["vérifier la présence de pnpm-lock.yaml"],
        remediation: "Committer le lockfile ; installer en --frozen-lockfile en CI.",
        retestable: false,
      });
    }

    // 3. Scanner externe optionnel (OSV / Trivy / pnpm audit).
    let scannerNote = "scanner de vulnérabilités non installé";
    const osv = await runScanner("osv-scanner", ctx.repoRoot, ctx.config);
    if (osv.installed) {
      scannerNote = `osv-scanner : ${osv.findings.length} findings`;
      findings.push(...osv.findings);
    } else {
      const trivy = await runScanner("trivy", ctx.repoRoot, ctx.config);
      if (trivy.installed) {
        scannerNote = `trivy : ${trivy.findings.length} findings`;
        findings.push(...trivy.findings);
      }
    }

    const manifests = walkFiles(ctx.repoRoot, { exts: ["package.json"], maxFiles: 50 })
      .filter((f) => !f.includes("node_modules"))
      .map((f) => relative(ctx.repoRoot, f).replace(/\\/g, "/"));

    return {
      findings,
      coverage: "TESTED",
      coverageNote: `${manifests.length} manifestes ; ${scannerNote}`,
    };
  },
};

function readJson(path: string): Record<string, unknown> | undefined {
  const raw = readFileSafe(path);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}
