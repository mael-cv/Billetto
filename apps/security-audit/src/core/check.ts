/** Interface commune à tous les checks (black-box, white-box, infra). */

import type { AuditConfig } from "./config";
import type { Category, FindingInput } from "./finding";
import type { CoverageStatus } from "./coverage";
import type { HttpClient } from "./http-client";
import type { Logger } from "./logger";
import type { RouteModel } from "../discovery/route-model";
import type { SessionManager } from "./sessions";
import type { CallbackServer } from "./callback-server";

export interface CheckResult {
  findings: FindingInput[];
  coverage: CoverageStatus;
  coverageNote?: string;
}

/** Contexte fourni à chaque check black-box. */
export interface BlackboxContext {
  config: AuditConfig;
  http: HttpClient;
  sessions: SessionManager;
  routes: RouteModel;
  logger: Logger;
  /** Base URL effective (sans slash final). */
  baseUrl: string;
  /** Profil actif (toggles). */
  aggressive: boolean; // profil full / --full
  /** Serveur de callback local pour la confirmation SSRF (optionnel). */
  callback?: CallbackServer;
}

/** Contexte fourni à chaque check white-box / infra. */
export interface WhiteboxContext {
  config: AuditConfig;
  repoRoot: string;
  logger: Logger;
}

export interface BlackboxCheck {
  id: string;
  category: Category;
  title: string;
  applies(ctx: BlackboxContext): boolean | Promise<boolean>;
  run(ctx: BlackboxContext): Promise<CheckResult>;
}

export interface WhiteboxCheck {
  id: string;
  category: Category;
  title: string;
  applies(ctx: WhiteboxContext): boolean | Promise<boolean>;
  run(ctx: WhiteboxContext): Promise<CheckResult>;
}

/** Helper : construit un CheckResult vide avec un statut de couverture. */
export function coverageOnly(
  coverage: CoverageStatus,
  coverageNote?: string,
): CheckResult {
  return { findings: [], coverage, coverageNote };
}
