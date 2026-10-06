import { join } from "node:path";
import type { WhiteboxCheck, WhiteboxContext, CheckResult } from "../../core/check";
import type { FindingInput, Severity } from "../../core/finding";
import { readFileSafe } from "../fs-util";
import { score, VECTORS } from "../../core/score";

/** Audit de configuration applicative (.env.example, docker-compose env). */
export const configurationCheck: WhiteboxCheck = {
  id: "configuration",
  category: "configuration",
  title: "Configuration applicative",
  applies: () => true,
  async run(ctx: WhiteboxContext): Promise<CheckResult> {
    const findings: FindingInput[] = [];
    const envExample = readFileSafe(join(ctx.repoRoot, ".env.example"));
    const compose = readFileSafe(join(ctx.repoRoot, "docker-compose.yml"));

    if (envExample) {
      // Mot de passe de démo en clair.
      const demo = envExample.match(/DEMO_PASSWORD\s*=\s*(.+)/);
      if (demo && demo[1] && demo[1].trim() && !/change[-_]?me|<|placeholder/i.test(demo[1])) {
        findings.push(cfg(".env.example", "Mot de passe de démo en clair dans .env.example", "LOW", "CWE-798",
          "Valeur DEMO_PASSWORD non-placeholder ; acceptable en dev mais à documenter comme non-production."));
      }
      // COOKIE_SECURE=false par défaut.
      if (/COOKIE_SECURE\s*=\s*false/i.test(envExample)) {
        findings.push(cfg(".env.example", "COOKIE_SECURE=false par défaut", "LOW", "CWE-614",
          "Mettre COOKIE_SECURE=true hors développement local HTTP."));
      }
    }

    if (compose) {
      // PAYMENTS_WEBHOOK_SECRET avec défaut vide → signature potentiellement désactivée.
      if (/PAYMENTS_WEBHOOK_SECRET\s*:\s*\$\{PAYMENTS_WEBHOOK_SECRET:-\}/.test(compose)) {
        findings.push(cfg("docker-compose.yml", "PAYMENTS_WEBHOOK_SECRET a un défaut vide", "MEDIUM", "CWE-347",
          "La vérification de signature du webhook peut être inopérante si le secret n'est pas fourni. Exiger un secret non vide."));
      }
    }

    return { findings, coverage: "TESTED" };
  },
};

function cfg(file: string, title: string, severity: Severity, cwe: string, remediation: string): FindingInput {
  const s = severity === "MEDIUM" ? score(VECTORS.infoLeak) : score({ ...VECTORS.infoLeak, C: "L" });
  return {
    title,
    severity,
    confidence: 0.8,
    status: "CONFIRMED",
    classification: "REAL_VULNERABILITY",
    category: "configuration",
    cwe,
    owasp: "A05:2021-Security Misconfiguration",
    cvss: s.cvss,
    cvssVector: s.cvssVector,
    source: "whitebox",
    location: { file },
    evidence: [{ note: title }],
    reproduction: [`inspecter ${file}`],
    remediation,
    retestable: false,
  };
}
