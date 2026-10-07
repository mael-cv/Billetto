#!/usr/bin/env tsx
/** CLI de la plateforme security-audit. */

import { parseArgs } from "node:util";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadConfig, resolveFromConfig, type ProfileName } from "./core/config";
import { AuditError, ExitCode, type ExitCodeValue } from "./core/exit-codes";
import { Logger, type LogLevel } from "./core/logger";
import { runAudit } from "./orchestrator";
import { renderJson } from "./reporting/json";
import { renderMarkdown } from "./reporting/markdown";
import { renderHtml } from "./reporting/html";
import { evaluateGate } from "./reporting/gate";
import { writeGithubSummary } from "./reporting/github-summary";
import { generateAiReviewPackage } from "./ai/review-package";
import { ReportStore } from "./core/report-store";
import { retestFinding } from "./core/retest";
import { severityCounts, SEVERITIES } from "./reporting/report";
import type { WhiteboxEngine } from "./whitebox";

// Comme database/scripts/psql.mjs : le .env racine fournit DEMO_PASSWORD (accounts.password_env).
// Les variables déjà définies (CI) priment.
try {
  process.loadEnvFile(resolve(__dirname, "..", "..", "..", ".env"));
} catch {
  /* pas de .env : environnement courant */
}

const HELP = `security-audit — plateforme d'audit (black-box + white-box + infra)

Usage :
  security-audit [options]            audit complet (white-box + infra, + black-box si cible joignable)
  security-audit --pentest [--full]   pentest black-box (--full = toutes catégories)
  security-audit --sast|--secrets|--dependencies|--infra   moteurs white-box ciblés
  security-audit --retest SEC-001     rejoue un finding -> PASS|FAIL|INCONCLUSIVE

Options :
  --profile quick|standard|full   profil d'exécution (défaut standard)
  --format json|md|html|all       formats de rapport (défaut all)
  --base-url <url>                cible (sinon config)
  --config <path>                 fichier de configuration YAML
  --target-start                  force l'auto-start de l'application
  --all-files                     scanner secrets y compris fichiers gitignorés
  --offline                       désactive les scanners externes
  --ci                            mode CI (step summary + exit code gate)
  --ai-package                    génère le AI Review Package
  --concurrency <n> / --max-requests <n>
  -v, --verbose / -q, --quiet / -h, --help
`;

async function main(): Promise<ExitCodeValue> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      pentest: { type: "boolean", default: false },
      full: { type: "boolean", default: false },
      local: { type: "boolean", default: false },
      sast: { type: "boolean", default: false },
      secrets: { type: "boolean", default: false },
      dependencies: { type: "boolean", default: false },
      infra: { type: "boolean", default: false },
      retest: { type: "string" },
      profile: { type: "string" },
      format: { type: "string", default: "all" },
      "base-url": { type: "string" },
      config: { type: "string" },
      "target-start": { type: "boolean", default: false },
      "all-files": { type: "boolean", default: false },
      offline: { type: "boolean", default: false },
      ci: { type: "boolean", default: false },
      "ai-package": { type: "boolean", default: false },
      concurrency: { type: "string" },
      "max-requests": { type: "string" },
      verbose: { type: "boolean", short: "v", default: false },
      quiet: { type: "boolean", short: "q", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  if (values.help) {
    process.stdout.write(HELP);
    return ExitCode.SUCCESS;
  }

  const level: LogLevel = values.quiet ? "warn" : values.verbose ? "debug" : "info";
  const logger = new Logger(level);

  const profile = (values.profile as ProfileName | undefined) ?? (values.full ? "full" : "standard");
  const config = loadConfig({
    configPath: values.config,
    baseUrl: values["base-url"],
    profile: values.full ? "full" : profile,
    allFiles: values["all-files"] ? true : undefined,
    concurrency: values.concurrency ? Number(values.concurrency) : undefined,
    maxRequests: values["max-requests"] ? Number(values["max-requests"]) : undefined,
  });

  if (values.offline) {
    for (const k of Object.keys(config.scanners)) config.scanners[k] = { enabled: false };
  }

  // --- Retest ---
  const retestId = values.retest ?? (positionals.length === 1 && /^SEC-/i.test(positionals[0] ?? "") ? positionals[0] : undefined);
  if (retestId) {
    const r = await retestFinding(config, retestId.toUpperCase(), logger);
    process.stdout.write(`\n${r.original.id ?? retestId} — ${r.original.title ?? ""}\n`);
    process.stdout.write(`Retest : ${r.verdict}\n${r.note}\n`);
    return r.verdict === "FAIL" ? ExitCode.GATE_FAILED : ExitCode.SUCCESS;
  }

  // --- Sélection des moteurs ---
  const explicitWb: WhiteboxEngine[] = [];
  if (values.sast) explicitWb.push("sast");
  if (values.secrets) explicitWb.push("secrets");
  if (values.dependencies) explicitWb.push("dependencies");
  if (values.infra) explicitWb.push("configuration", "docker", "cicd", "infrastructure");

  const anyExplicit = values.pentest || explicitWb.length > 0;
  const runPentest = values.pentest || (!anyExplicit); // défaut : tout
  const runWhitebox = explicitWb.length > 0 || (!anyExplicit) || values.local;
  const wbEngines = explicitWb.length > 0 ? explicitWb : undefined;

  logger.step(`security-audit — profil ${config._profile} — ${runPentest ? "black-box" : ""}${runPentest && runWhitebox ? " + " : ""}${runWhitebox ? "white-box" : ""}`);

  const { report } = await runAudit(config, {
    pentest: runPentest,
    whitebox: runWhitebox,
    whiteboxEngines: wbEngines,
    forceStart: values["target-start"],
    logger,
  });

  // --- Écriture des rapports ---
  const outDir = resolveFromConfig(config, config.output.dir);
  mkdirSync(outDir, { recursive: true });
  const fmt = String(values.format);
  if (fmt === "json" || fmt === "all") writeFileSync(join(outDir, "security-report.json"), renderJson(report), "utf8");
  if (fmt === "md" || fmt === "all") writeFileSync(join(outDir, "security-report.md"), renderMarkdown(report), "utf8");
  if (fmt === "html" || fmt === "all") writeFileSync(join(outDir, "security-report.html"), renderHtml(report), "utf8");

  // Persistance pour le retest.
  new ReportStore(outDir).save({
    timestamp: report.meta.timestamp,
    baseUrl: report.meta.baseUrl,
    profile: report.meta.profile,
    findings: report.findings,
    coverage: report.coverage,
  });

  if (values["ai-package"]) {
    const dir = generateAiReviewPackage(report, outDir);
    logger.step(`AI Review Package : ${dir}`);
  }

  // --- Gate + résumé ---
  const gate = evaluateGate(report, config);
  if (values.ci) writeGithubSummary(report, gate);

  printSummary(report, gate, logger, outDir);

  if (!gate.passed && values.ci) return ExitCode.GATE_FAILED;
  return ExitCode.SUCCESS;
}

function printSummary(
  report: Parameters<typeof evaluateGate>[0],
  gate: ReturnType<typeof evaluateGate>,
  logger: Logger,
  outDir: string,
): void {
  const counts = severityCounts(report.findings);
  logger.info("");
  logger.info("═══ security-audit ═══");
  logger.info(`Cible : ${report.meta.baseUrl} (${report.meta.appReachable ? "joignable" : "non joignable"})`);
  logger.info(SEVERITIES.map((s) => `${s} ${counts[s]}`).join("  "));
  logger.info(`Couverture : ${report.coveragePercent}%`);
  logger.info(`Gate : ${gate.passed ? "PASS" : "FAIL — " + gate.reasons.join(" ; ")}`);
  logger.info(`Rapports : ${outDir}`);
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    if (e instanceof AuditError) {
      process.stderr.write(`✗ ${e.message}\n`);
      process.exit(e.code);
    }
    process.stderr.write(`✗ Erreur inattendue : ${(e as Error).stack ?? String(e)}\n`);
    process.exit(ExitCode.SCANNER_ERROR);
  });
