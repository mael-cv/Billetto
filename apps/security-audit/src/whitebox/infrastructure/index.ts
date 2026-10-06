import { join } from "node:path";
import type { WhiteboxCheck, WhiteboxContext, CheckResult } from "../../core/check";
import type { FindingInput } from "../../core/finding";
import { walkFiles, readFileSafe } from "../fs-util";
import { score, VECTORS } from "../../core/score";

/**
 * Infrastructure as Code + revue du reverse proxy. Si aucune IaC (Terraform/
 * Helm/K8s), on marque NOT_APPLICABLE pour l'IaC et on revoit tout de même nginx.
 */
export const infrastructureCheck: WhiteboxCheck = {
  id: "infrastructure",
  category: "infrastructure",
  title: "Infrastructure (IaC + reverse proxy)",
  applies: () => true,
  async run(ctx: WhiteboxContext): Promise<CheckResult> {
    const findings: FindingInput[] = [];

    // 1. IaC présente ?
    const iac = walkFiles(ctx.repoRoot, { exts: [".tf", ".tfvars"], maxFiles: 10 })
      .concat(walkFiles(ctx.repoRoot, { exts: ["Chart.yaml"], maxFiles: 5 }));
    const hasIac = iac.length > 0;

    // 2. Revue nginx.
    const nginx = readFileSafe(join(ctx.repoRoot, "infra", "nginx", "nginx.conf"));
    if (nginx) {
      if (!/server_tokens\s+off/.test(nginx)) {
        findings.push(infra("infra/nginx/nginx.conf", "nginx : server_tokens non désactivé (version divulguée)", "LOW", "CWE-200",
          "Ajouter 'server_tokens off;'."));
      }
      const hasSecurityHeaders = /add_header\s+(Content-Security-Policy|X-Frame-Options|X-Content-Type-Options|Strict-Transport-Security)/i.test(nginx);
      if (!hasSecurityHeaders) {
        findings.push(infra("infra/nginx/nginx.conf", "nginx : aucun en-tête de sécurité sur le contenu statique", "LOW", "CWE-693",
          "Ajouter CSP/X-Frame-Options/X-Content-Type-Options/Referrer-Policy au tier statique."));
      }
      if (/proxy_set_header\s+Connection\s+['"]?upgrade['"]?;/i.test(nginx) && !/map\s+\$http_upgrade/.test(nginx)) {
        findings.push(infra("infra/nginx/nginx.conf", "nginx : 'Connection: upgrade' inconditionnel (pas de map $http_upgrade)", "INFO", "CWE-444",
          "Conditionner l'upgrade via 'map $http_upgrade $connection_upgrade'."));
      }
    }

    const coverageNote = hasIac ? `${iac.length} fichiers IaC` : "aucune IaC (Terraform/Helm/K8s)";
    // La couverture IaC proprement dite est N/A si absente ; la revue nginx reste TESTED.
    return { findings, coverage: nginx || hasIac ? "TESTED" : "NOT_APPLICABLE", coverageNote };
  },
};

function infra(file: string, title: string, severity: FindingInput["severity"], cwe: string, remediation: string): FindingInput {
  const s = score({ ...VECTORS.infoLeak, C: "L" });
  return {
    title,
    severity,
    confidence: 0.8,
    status: "CONFIRMED",
    classification: "REAL_VULNERABILITY",
    category: "infrastructure",
    cwe,
    owasp: "A05:2021-Security Misconfiguration",
    cvss: s.cvss,
    cvssVector: s.cvssVector,
    source: "infra",
    location: { file },
    evidence: [{ note: title }],
    reproduction: [`inspecter ${file}`],
    remediation,
    retestable: false,
  };
}
