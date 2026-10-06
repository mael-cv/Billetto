import { relative, basename } from "node:path";
import type { WhiteboxCheck, WhiteboxContext, CheckResult } from "../../core/check";
import type { FindingInput } from "../../core/finding";
import { walkFiles, readFileSafe, GitignoreMatcher } from "../fs-util";
import { shannonEntropy } from "../../core/evidence";
import { score, VECTORS } from "../../core/score";

/**
 * Détection de secrets. Respecte .gitignore par défaut (le .env local n'est donc
 * scanné qu'avec secrets.all_files=true). Toute valeur sensible est REDACTÉE :
 * on ne stocke jamais le secret, seulement son emplacement et son type.
 */
interface SecretRule {
  id: string;
  rx: RegExp;
  title: string;
}

const RULES: SecretRule[] = [
  { id: "private-key", rx: /-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/, title: "Clé privée" },
  { id: "aws-key", rx: /AKIA[0-9A-Z]{16}/, title: "Clé d'accès AWS" },
  { id: "jwt", rx: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/, title: "JWT en dur" },
  { id: "db-url", rx: /(postgres(ql)?|mysql|mongodb|redis):\/\/[^:\s]+:[^@\s]+@/, title: "URL de base avec identifiants" },
  { id: "generic-secret", rx: /(password|passwd|secret|api[_-]?key|token|client[_-]?secret)\s*[:=]\s*['"][^'"\s]{8,}['"]/i, title: "Secret affecté en dur" },
  { id: "slack-token", rx: /xox[baprs]-[0-9A-Za-z-]{10,}/, title: "Jeton Slack" },
];

// Fichiers d'exemple : on signale en INFO (placeholders attendus).
const EXAMPLE = /\.example$|\.sample$|\.dist$/;

export const secretsCheck: WhiteboxCheck = {
  id: "secrets",
  category: "secrets",
  title: "Détection de secrets",
  applies: () => true,
  async run(ctx: WhiteboxContext): Promise<CheckResult> {
    const allFiles = ctx.config.secrets.all_files;
    const gi = allFiles ? undefined : GitignoreMatcher.fromRepo(ctx.repoRoot);
    const files = walkFiles(ctx.repoRoot, {
      gitignore: gi,
      maxFiles: 6000,
    }).filter((f) => !isBinary(f));

    const findings: FindingInput[] = [];
    for (const file of files) {
      const content = readFileSafe(file);
      if (!content || content.length > 2_000_000) continue;
      const rel = relative(ctx.repoRoot, file).replace(/\\/g, "/");
      const isExample = EXAMPLE.test(basename(file));
      const isTest = /\.spec\.|\.test\.|\/tests?\//.test(rel);
      // Fixtures, documentation et markdown : contenu d'illustration, jamais de prod.
      const isIllustrative = /\/fixtures?\/|\/docs?\/|\.md$/.test(rel);
      const lines = content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? "";
        for (const rule of RULES) {
          if (!rule.rx.test(line)) continue;
          // Placeholder / variable / env → pas un vrai secret (sauf clé privée).
          if (
            rule.id !== "private-key" &&
            /change[-_ ]?me|remplacer|placeholder|xxxx|your[-_]|<[^>]+>|\$\{|\$\(|process\.env|import\.meta\.env|%[A-Z_]+%/i.test(line)
          )
            continue;
          // Variables psql / identifiants ( :'app_password' , password = 'snake_case' )
          // = nom de variable, pas un secret en dur.
          if (rule.id === "generic-secret" && /[:=]\s*['"][a-z][a-z0-9_]*['"]|:'[a-z_]+'/.test(line)) continue;
          // Valeurs manifestement de test/démo.
          const looksLikeTestValue = /wrong|dummy|sample|fixture|demo|example|fake|test[-_]/i.test(line);
          const downgrade = isExample || isTest || isIllustrative || looksLikeTestValue;
          const severity = downgrade ? "INFO" : rule.id === "private-key" || rule.id === "db-url" ? "HIGH" : "MEDIUM";
          const s = severity === "HIGH" ? score({ ...VECTORS.infoLeak, C: "H" }) : score(VECTORS.infoLeak);
          findings.push({
            title: `${rule.title}${isExample ? " (fichier d'exemple)" : isTest ? " (fichier de test)" : ""}`,
            severity,
            confidence: downgrade ? 0.3 : 0.7,
            status: downgrade ? "NEEDS_REVIEW" : "SUSPECTED",
            classification: "REAL_VULNERABILITY",
            category: "secrets",
            cwe: "CWE-798",
            owasp: "A07:2021-Identification and Authentication Failures",
            cvss: s.cvss,
            cvssVector: s.cvssVector,
            source: "whitebox",
            location: { file: rel, line: i + 1 },
            // JAMAIS la valeur : seulement le type et l'emplacement.
            evidence: [{ snippet: "[REDACTED] (secret détecté, valeur masquée)", note: `règle ${rule.id}, entropie≈${shannonEntropy(line).toFixed(1)}` }],
            reproduction: [`${rel}:${i + 1} — secret potentiel (${rule.id})`],
            remediation: "Retirer le secret du dépôt, le faire tourner, utiliser des variables d'environnement/secrets manager.",
            retestable: false,
          });
        }
      }
    }

    const note = allFiles ? `${files.length} fichiers (y compris gitignorés)` : `${files.length} fichiers suivis`;
    return { findings, coverage: "TESTED", coverageNote: note };
  },
};

const BINARY_EXT = /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|tar|woff2?|ttf|eot|mp4|mp3|wasm|node|lock)$/i;
function isBinary(path: string): boolean {
  return BINARY_EXT.test(path) || path.endsWith("pnpm-lock.yaml");
}
