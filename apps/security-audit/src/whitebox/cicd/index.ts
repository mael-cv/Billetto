import { join } from "node:path";
import type { WhiteboxCheck, WhiteboxContext, CheckResult } from "../../core/check";
import type { FindingInput, Severity } from "../../core/finding";
import { walkFiles, readFileSafe } from "../fs-util";
import { score, VECTORS } from "../../core/score";

/** Audit CI/CD : GitHub Actions. */
export const cicdCheck: WhiteboxCheck = {
  id: "cicd",
  category: "cicd",
  title: "CI/CD (GitHub Actions)",
  applies(ctx) {
    return walkFiles(join(ctx.repoRoot, ".github", "workflows"), { exts: [".yml", ".yaml"], maxFiles: 50 }).length > 0;
  },
  async run(ctx: WhiteboxContext): Promise<CheckResult> {
    const dir = join(ctx.repoRoot, ".github", "workflows");
    const files = walkFiles(dir, { exts: [".yml", ".yaml"], maxFiles: 50 });
    const findings: FindingInput[] = [];

    for (const file of files) {
      const content = readFileSafe(file);
      if (!content) continue;
      const rel = file.replace(/\\/g, "/").split("/").slice(-3).join("/");

      // pull_request_target : exposition de secrets aux forks.
      if (/pull_request_target/.test(content)) {
        findings.push(ci(rel, "Déclencheur pull_request_target (risque d'exécution de code de fork avec secrets)", "HIGH", "CWE-draft"));
      }
      // Actions épinglées par tag mutable et non par SHA.
      const usesTags = [...content.matchAll(/uses:\s*([\w./-]+)@([\w.-]+)/g)];
      const unpinned = usesTags.filter(([, , ref]) => !/^[0-9a-f]{40}$/.test(ref ?? ""));
      if (unpinned.length > 0) {
        findings.push(ci(rel, `Actions GitHub épinglées par tag mutable et non par SHA (${unpinned.length})`, "LOW", "CWE-494"));
      }
      // Pas de bloc permissions → permissions larges par défaut.
      if (!/^permissions:/m.test(content) && !/\n\s{2}permissions:/.test(content)) {
        findings.push(ci(rel, "Aucun bloc 'permissions' (jetons GITHUB_TOKEN potentiellement trop larges)", "LOW", "CWE-250"));
      }
      // Injection de contexte non fiable dans un run.
      if (/run:[\s\S]{0,200}\$\{\{\s*github\.event\.(pull_request\.title|pull_request\.body|issue\.title|comment\.body|head_ref)/.test(content)) {
        findings.push(ci(rel, "Interpolation d'entrée non fiable (github.event.*) dans un script run", "HIGH", "CWE-94"));
      }
    }

    // Dependabot / CODEOWNERS absents (bonnes pratiques).
    if (!readFileSafe(join(ctx.repoRoot, ".github", "dependabot.yml")) && !readFileSafe(join(ctx.repoRoot, ".github", "dependabot.yaml"))) {
      findings.push(ci(".github", "Pas de configuration Dependabot (mises à jour de sécurité non automatisées)", "INFO", "CWE-1104"));
    }

    return { findings, coverage: "TESTED", coverageNote: `${files.length} workflows` };
  },
};

function ci(file: string, title: string, severity: Severity, cwe: string): FindingInput {
  const s = severity === "HIGH" ? score({ ...VECTORS.privEsc }) : score({ ...VECTORS.infoLeak, C: "L" });
  return {
    title,
    severity,
    confidence: 0.8,
    status: "CONFIRMED",
    classification: "REAL_VULNERABILITY",
    category: "cicd",
    cwe,
    owasp: "A08:2021-Software and Data Integrity Failures",
    cvss: s.cvss,
    cvssVector: s.cvssVector,
    source: "infra",
    location: { file },
    evidence: [{ note: title }],
    reproduction: [`inspecter ${file}`],
    remediation: "Appliquer les bonnes pratiques GitHub Actions (SHA pinning, permissions minimales, pas d'input non fiable).",
    retestable: false,
  };
}
