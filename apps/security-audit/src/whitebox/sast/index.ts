import { relative } from "node:path";
import type { WhiteboxCheck, WhiteboxContext, CheckResult } from "../../core/check";
import type { FindingInput, Severity } from "../../core/finding";
import { walkFiles, readFileSafe, GitignoreMatcher } from "../fs-util";
import { score, VECTORS } from "../../core/score";
import { applySuppression } from "../suppression";
import { runScanner } from "../../scanners/registry";

/**
 * SAST par règles déterministes (TS/JS/SQL). Best-effort, pensé pour éviter les
 * faux positifs évidents (ex. ignore les commentaires simples quand possible).
 */
interface Rule {
  id: string;
  rx: RegExp;
  title: string;
  severity: Severity;
  cwe: string;
  owasp: string;
  remediation: string;
  // Ignore la ligne si elle matche ceci (ex. commentaire, test).
  ignore?: RegExp;
}

const RULES: Rule[] = [
  { id: "sql-raw-unsafe", rx: /\$queryRawUnsafe\s*\(|\$executeRawUnsafe\s*\(|Prisma\.raw\s*\(/, title: "Requête SQL brute non paramétrée (Prisma)", severity: "HIGH", cwe: "CWE-89", owasp: "A03:2021-Injection", remediation: "Utiliser $queryRaw paramétré (template tag) plutôt que Unsafe/raw." },
  { id: "sql-concat", rx: /(SELECT|INSERT|UPDATE|DELETE)\b[^;'"`]*["'`]\s*\+\s*\w/i, title: "Concaténation de chaîne dans une requête SQL", severity: "HIGH", cwe: "CWE-89", owasp: "A03:2021-Injection", remediation: "Requêtes paramétrées." },
  { id: "eval", rx: /\beval\s*\(|new\s+Function\s*\(/, title: "Utilisation de eval / new Function", severity: "HIGH", cwe: "CWE-95", owasp: "A03:2021-Injection", remediation: "Éviter l'évaluation dynamique de code." },
  { id: "child-process-shell", rx: /\bexec\s*\(\s*[`"'].*\$\{|\bexecSync\s*\(\s*[`"'].*\$\{/, title: "Exécution de commande shell avec interpolation", severity: "HIGH", cwe: "CWE-78", owasp: "A03:2021-Injection", remediation: "Utiliser execFile/spawn avec arguments séparés ; ne jamais interpoler d'entrée dans un shell." },
  { id: "child-process", rx: /require\(['"]child_process['"]\)|from\s+['"]node:child_process['"]|\bexecSync\s*\(|\bspawnSync\s*\(/, title: "Utilisation de child_process", severity: "LOW", cwe: "CWE-78", owasp: "A03:2021-Injection", remediation: "Vérifier qu'aucune entrée non fiable n'atteint la commande ; préférer execFile/spawn avec args." },
  { id: "dangerous-html", rx: /dangerouslySetInnerHTML|\.innerHTML\s*=/, title: "Injection HTML potentielle (innerHTML)", severity: "MEDIUM", cwe: "CWE-79", owasp: "A03:2021-Injection", remediation: "Encoder/assainir le contenu ; éviter innerHTML." },
  { id: "cors-wildcard", rx: /Access-Control-Allow-Origin["'\s:]+\*|origin\s*:\s*['"]\*['"]/, title: "CORS wildcard en dur", severity: "MEDIUM", cwe: "CWE-942", owasp: "A05:2021-Security Misconfiguration", remediation: "Restreindre à une allowlist d'origines." },
  { id: "md5-sha1", rx: /createHash\(\s*['"](md5|sha1)['"]\s*\)/, title: "Fonction de hachage faible (MD5/SHA1)", severity: "LOW", cwe: "CWE-327", owasp: "A02:2021-Cryptographic Failures", remediation: "Utiliser SHA-256+ / bcrypt / argon2 selon l'usage." },
  { id: "math-random-token", rx: /Math\.random\(\)[^;]*(token|secret|password|id)/i, title: "Math.random() pour une valeur sensible", severity: "MEDIUM", cwe: "CWE-338", owasp: "A02:2021-Cryptographic Failures", remediation: "Utiliser crypto.randomBytes/randomUUID." },
];

export const sastCheck: WhiteboxCheck = {
  id: "sast",
  category: "sast",
  title: "Analyse statique (SAST par règles)",
  applies: () => true,
  async run(ctx: WhiteboxContext): Promise<CheckResult> {
    const gi = GitignoreMatcher.fromRepo(ctx.repoRoot);
    const files = walkFiles(ctx.repoRoot, {
      exts: [".ts", ".tsx", ".js", ".mjs", ".sql"],
      gitignore: gi,
      maxFiles: 4000,
    }).filter((f) => {
      const n = f.replace(/\\/g, "/");
      if (/\.spec\.|\.test\.|\/test\//.test(n)) return false;
      // Les fichiers de règles du scanner contiennent par nature les motifs
      // qu'ils détectent : on évite qu'il se signale lui-même.
      return !/apps\/security-audit\/src\/(whitebox\/(sast|secrets)\/index\.ts|scanners\/registry\.ts|core\/evidence\.ts)/.test(n);
    });

    const findings: FindingInput[] = [];
    for (const file of files) {
      const content = readFileSafe(file);
      if (!content) continue;
      const rel = relative(ctx.repoRoot, file).replace(/\\/g, "/");
      const lines = content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? "";
        if (/^\s*(\/\/|\*|#)/.test(line)) continue; // commentaire
        for (const rule of RULES) {
          if (rule.rx.test(line) && !(rule.ignore && rule.ignore.test(line))) {
            const s = ruleScore(rule.severity);
            findings.push(...applySuppression({
              title: rule.title,
              severity: rule.severity,
              confidence: 0.6,
              status: "SUSPECTED",
              classification: "REAL_VULNERABILITY",
              category: "sast",
              cwe: rule.cwe,
              owasp: rule.owasp,
              cvss: s.cvss,
              cvssVector: s.cvssVector,
              source: "whitebox",
              location: { file: rel, line: i + 1 },
              evidence: [{ snippet: line.trim().slice(0, 200), note: `règle ${rule.id}` }],
              reproduction: [`${rel}:${i + 1} — motif ${rule.id}`],
              remediation: rule.remediation,
              retestable: false,
            }, lines, i, rule.id, rel));
          }
        }
      }
    }

    // Scanner SAST externe optionnel (semgrep). NOT_INSTALLED/désactivé => no-op.
    let scannerNote = "semgrep non installé";
    const semgrep = await runScanner("semgrep", ctx.repoRoot, ctx.config);
    if (semgrep.installed) {
      scannerNote = `semgrep : ${semgrep.findings.length} findings`;
      findings.push(...semgrep.findings);
    }

    return { findings, coverage: "TESTED", coverageNote: `${files.length} fichiers analysés ; ${scannerNote}` };
  },
};

function ruleScore(sev: Severity) {
  if (sev === "HIGH") return score(VECTORS.sqli);
  if (sev === "MEDIUM") return score(VECTORS.infoLeak);
  return score({ ...VECTORS.infoLeak, C: "L" });
}
