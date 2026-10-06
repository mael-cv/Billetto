import { join } from "node:path";
import type { WhiteboxCheck, WhiteboxContext, CheckResult } from "../../core/check";
import type { FindingInput, Severity } from "../../core/finding";
import { readFileSafe } from "../fs-util";
import { score, VECTORS } from "../../core/score";

/** Audit Docker : Dockerfile + docker-compose. */
export const dockerCheck: WhiteboxCheck = {
  id: "docker",
  category: "docker",
  title: "Durcissement Docker",
  applies(ctx) {
    return !!readFileSafe(join(ctx.repoRoot, "Dockerfile")) || !!readFileSafe(join(ctx.repoRoot, "docker-compose.yml"));
  },
  async run(ctx: WhiteboxContext): Promise<CheckResult> {
    const findings: FindingInput[] = [];
    const dockerfile = readFileSafe(join(ctx.repoRoot, "Dockerfile"));
    const compose = readFileSafe(join(ctx.repoRoot, "docker-compose.yml"));

    if (dockerfile) {
      const stages = dockerfile.split(/^FROM /mi).slice(1);
      // Étape finale sans USER non-root ?
      const finalStage = stages[stages.length - 1] ?? "";
      const anyUser = /^\s*USER\s+(?!root\b)\w+/mi.test(dockerfile);
      // Image finale basée nginx sans USER = root (cas connu).
      if (/nginx/i.test(finalStage) && !/^\s*USER\s/mi.test(finalStage)) {
        findings.push(dk("Dockerfile", "Conteneur web (nginx) s'exécute en root", "LOW", "CWE-250",
          "Définir un USER non-root ou utiliser une image nginx non-root."));
      }
      if (!anyUser) {
        findings.push(dk("Dockerfile", "Aucune directive USER non-root détectée", "LOW", "CWE-250",
          "Exécuter les conteneurs en utilisateur non privilégié."));
      }
      // Tags mutables (pas de digest).
      if (/^FROM\s+[\w./-]+:[\w.-]+\s*(AS|$)/mi.test(dockerfile) && !/@sha256:/i.test(dockerfile)) {
        findings.push(dk("Dockerfile", "Images de base épinglées par tag et non par digest", "LOW", "CWE-494",
          "Épingler les images par digest (@sha256:...) pour la reproductibilité/supply-chain."));
      }
      // Copie de tout le repo dans l'image finale (source + devDeps).
      if (/COPY\s+--from=\S+\s+\/repo\s+\/repo/i.test(dockerfile)) {
        findings.push(dk("Dockerfile", "L'image finale embarque tout le dépôt (source + devDependencies)", "LOW", "CWE-1104",
          "Ne copier que le nécessaire (dist + deps de prod) pour réduire la surface."));
      }
    }

    if (compose) {
      if (/privileged:\s*true/i.test(compose)) {
        findings.push(dk("docker-compose.yml", "Conteneur en mode privileged", "HIGH", "CWE-250",
          "Retirer privileged ; n'accorder que les capabilities nécessaires."));
      }
      // pgAdmin avec compte propriétaire DB.
      if (/billetto_owner/.test(compose) || /servers\.json/.test(compose)) {
        // Vérifié plus finement via servers.json ci-dessous.
      }
      // Ports exposés sur toutes interfaces (pas de 127.0.0.1).
      const exposeAll = /ports:\s*(\n\s*-\s*["']?\d+:\d+["']?)+/m.test(compose) && !/127\.0\.0\.1:/.test(compose);
      if (exposeAll) {
        findings.push(dk("docker-compose.yml", "Ports publiés sur toutes les interfaces (pas de binding 127.0.0.1)", "LOW", "CWE-668",
          "Lier les ports de dev à 127.0.0.1 pour éviter l'exposition réseau."));
      }
    }

    const servers = readFileSafe(join(ctx.repoRoot, "infra", "pgadmin", "servers.json"));
    if (servers && /billetto_owner/.test(servers)) {
      findings.push(dk("infra/pgadmin/servers.json", "pgAdmin préconfiguré avec le compte propriétaire de la base", "LOW", "CWE-250",
        "Utiliser un compte en lecture seule pour l'accès BI/admin plutôt que le propriétaire."));
    }

    return { findings, coverage: "TESTED" };
  },
};

function dk(file: string, title: string, severity: Severity, cwe: string, remediation: string): FindingInput {
  const s = severity === "HIGH" ? score({ ...VECTORS.privEsc }) : score({ ...VECTORS.infoLeak, C: "L" });
  return {
    title,
    severity,
    confidence: 0.8,
    status: "CONFIRMED",
    classification: "REAL_VULNERABILITY",
    category: "docker",
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
