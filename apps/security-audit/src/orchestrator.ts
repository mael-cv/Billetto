/**
 * Orchestrateur : target-safety → lifecycle → discovery → sessions → checks
 * (black-box + white-box) → corrélation → dedup → honeypots → rapport.
 */

import { assertSafeTarget } from "./core/target-safety";
import { HttpClient } from "./core/http-client";
import { SessionManager } from "./core/sessions";
import { CallbackServer } from "./core/callback-server";
import { Lifecycle } from "./core/lifecycle";
import { CoverageRegistry } from "./core/coverage";
import { toFinding, type Category, type Finding } from "./core/finding";
import { AuditError, ExitCode } from "./core/exit-codes";
import { activeProfile, resolveFromConfig, type AuditConfig } from "./core/config";
import type { BlackboxContext, WhiteboxContext, BlackboxCheck, WhiteboxCheck } from "./core/check";
import { Logger } from "./core/logger";
import { runDiscovery } from "./discovery";
import { originOf } from "./pentest/util";
import { selectChecks } from "./pentest";
import { selectWhitebox, type WhiteboxEngine } from "./whitebox";
import { correlate } from "./correlation";
import { dedupe } from "./core/dedup";
import { classifyHoneypots } from "./pentest/honeypots";
import { scannerStatus } from "./scanners/registry";
import type { ReportData, ReportMeta } from "./reporting/report";

const ALL_CATEGORIES: Category[] = [
  "discovery", "http-methods", "middleware", "authentication", "bruteforce",
  "account-enumeration", "authorization", "privilege-escalation", "input-fuzzing",
  "injection", "xss", "csrf", "cors", "security-headers", "cookies", "session",
  "jwt", "error-handling", "debug-endpoints", "file-upload", "path-traversal",
  "ssrf", "open-redirect", "api", "rate-limiting", "resource-exhaustion",
  "http-desync", "websockets", "timing", "business-logic",
  "sast", "secrets", "dependencies", "configuration", "docker", "cicd", "infrastructure",
];

export interface RunOptions {
  pentest: boolean;
  whitebox: boolean;
  whiteboxEngines?: WhiteboxEngine[];
  forceStart?: boolean;
  logger: Logger;
}

export interface RunOutput {
  report: ReportData;
  findings: Finding[];
}

export async function runAudit(config: AuditConfig, opts: RunOptions): Promise<RunOutput> {
  const logger = opts.logger;
  const coverage = new CoverageRegistry();
  for (const c of ALL_CATEGORIES) coverage.set(c, "NOT_TESTED");

  const baseUrl = config.target.base_url.replace(/\/+$/, "");
  const origin = originOf(baseUrl);

  const http = new HttpClient({
    allowedHosts: config.target.allowed_hosts,
    concurrency: config.limits.concurrency,
    maxRequests: config.limits.max_requests,
    timeoutMs: config.limits.request_timeout_ms,
    logger,
  });

  const rawFindings: Finding[] = [];
  let appReachable = false;
  let routesForCorrelation = undefined as undefined | Awaited<ReturnType<typeof runDiscovery>>;

  // ---- BLACK-BOX ----
  if (opts.pentest) {
    // 1. Target safety (obligatoire avant tout test actif).
    try {
      const target = await assertSafeTarget(baseUrl, { allowedHosts: config.target.allowed_hosts });
      logger.step(`Cible autorisée : ${target.hostname} (${target.resolvedIps.join(", ")})`);
    } catch (e) {
      throw new AuditError(`TARGET SAFETY : ${(e as Error).message}`, ExitCode.CONFIG_ERROR);
    }

    // 2. Lifecycle : détection + auto-start optionnel.
    const lifecycle = new Lifecycle(config, http, baseUrl, logger);
    const handle = await lifecycle.ensureUp({ forceStart: opts.forceStart });
    appReachable = (await lifecycle.probe());

    if (!appReachable) {
      logger.warn("Application non joignable : les tests black-box sont ignorés (NOT_TESTED).");
    } else {
      const sessions = new SessionManager(config, http, baseUrl, logger);
      const callback = new CallbackServer();
      await callback.start();

      try {
        const ok = await sessions.bootstrap();
        logger.step(`Sessions : ${ok.join(", ")}`);

        const repoRoot = config.repo_root ? resolveFromConfig(config, config.repo_root) : undefined;
        const routes = await runDiscovery({
          http,
          sessions,
          baseUrl,
          origin,
          repoRoot,
          logger,
          documentedRoutes: config.target.routes,
        });
        routesForCorrelation = routes;
        coverage.set("discovery", "TESTED", `${routes.size()} routes`);

        const ctx: BlackboxContext = {
          config,
          http,
          sessions,
          routes,
          logger,
          baseUrl,
          aggressive: config._profile === "full",
          callback,
        };

        const checks = selectChecks(activeProfile(config));
        for (const check of checks) {
          await runBlackboxCheck(check, ctx, coverage, rawFindings, logger);
        }
      } finally {
        await callback.stop();
        if (handle.started) await handle.stop();
      }
    }
  }

  // ---- WHITE-BOX ----
  if (opts.whitebox) {
    const repoRoot = resolveFromConfig(config, config.repo_root);
    const wctx: WhiteboxContext = { config, repoRoot, logger };
    const checks = selectWhitebox(opts.whiteboxEngines);
    for (const check of checks) {
      await runWhiteboxCheck(check, wctx, coverage, rawFindings, logger);
    }
  }

  // ---- CORRÉLATION + DEDUP + HONEYPOTS ----
  let findings = rawFindings;
  if (routesForCorrelation) findings = correlate(findings, routesForCorrelation);
  findings = dedupe(findings);
  findings = classifyHoneypots(findings, config);
  // Horodatage (hors contexte workflow : Date autorisé ici).
  const now = new Date().toISOString();
  for (const f of findings) if (!f.firstSeen) f.firstSeen = now;

  const meta: ReportMeta = {
    timestamp: now,
    baseUrl,
    profile: config._profile,
    repoRoot: opts.whitebox ? resolveFromConfig(config, config.repo_root) : undefined,
    requestsMade: http.requestsMade(),
    scanners: await scannerStatus(config),
    appReachable,
  };

  const report: ReportData = {
    meta,
    findings,
    coverage: coverage.all(),
    coveragePercent: coverage.percent(),
  };

  return { report, findings };
}

async function runBlackboxCheck(
  check: BlackboxCheck,
  ctx: BlackboxContext,
  coverage: CoverageRegistry,
  sink: Finding[],
  logger: Logger,
): Promise<void> {
  try {
    if (!(await check.applies(ctx))) {
      coverage.set(check.category, "NOT_APPLICABLE", `${check.id} non applicable`);
      return;
    }
    logger.debug(`black-box: ${check.id}`);
    const res = await check.run(ctx);
    coverage.set(check.category, res.coverage, res.coverageNote);
    for (const fi of res.findings) sink.push(toFinding(fi));
  } catch (e) {
    logger.warn(`check ${check.id} a échoué : ${(e as Error).message}`);
    coverage.set(check.category, "INCONCLUSIVE", `erreur : ${(e as Error).message}`);
  }
}

async function runWhiteboxCheck(
  check: WhiteboxCheck,
  ctx: WhiteboxContext,
  coverage: CoverageRegistry,
  sink: Finding[],
  logger: Logger,
): Promise<void> {
  try {
    if (!(await check.applies(ctx))) {
      coverage.set(check.category, "NOT_APPLICABLE", `${check.id} non applicable`);
      return;
    }
    logger.debug(`white-box: ${check.id}`);
    const res = await check.run(ctx);
    coverage.set(check.category, res.coverage, res.coverageNote);
    for (const fi of res.findings) sink.push(toFinding(fi));
  } catch (e) {
    logger.warn(`moteur ${check.id} a échoué : ${(e as Error).message}`);
    coverage.set(check.category, "INCONCLUSIVE", `erreur : ${(e as Error).message}`);
  }
}
