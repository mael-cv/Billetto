/**
 * Retest d'un finding : rejoue l'audit du côté pertinent (black-box ou white-box)
 * et vérifie si un finding équivalent réapparaît.
 *   PASS = corrigé (absent) · FAIL = toujours vulnérable (présent) · INCONCLUSIVE.
 */

import type { AuditConfig } from "./config";
import { findingKey } from "./dedup";
import type { Finding } from "./finding";
import { Logger } from "./logger";
import { ReportStore } from "./report-store";
import { resolveFromConfig } from "./config";
import { runAudit } from "../orchestrator";

export type RetestVerdict = "PASS" | "FAIL" | "INCONCLUSIVE";

export interface RetestResult {
  verdict: RetestVerdict;
  original: Finding;
  current?: Finding;
  note: string;
}

export async function retestFinding(
  config: AuditConfig,
  findingId: string,
  logger: Logger,
): Promise<RetestResult> {
  const store = new ReportStore(resolveFromConfig(config, config.output.dir));
  const original = store.findFinding(findingId);
  if (!original) {
    return {
      verdict: "INCONCLUSIVE",
      original: { id: findingId } as Finding,
      note: `Finding ${findingId} introuvable dans le dernier run. Lancez d'abord un audit.`,
    };
  }

  const isWhitebox = original.source === "whitebox" || original.source === "infra";
  const isBlackbox = original.source === "blackbox" || original.source === "correlated";

  try {
    const { findings } = await runAudit(config, {
      pentest: isBlackbox || original.source === "correlated",
      whitebox: isWhitebox || original.source === "correlated",
      logger,
    });
    const key = findingKey(original);
    const current = findings.find((f) => findingKey(f) === key);
    if (current) {
      return { verdict: "FAIL", original, current, note: "Le finding est toujours présent (STILL VULNERABLE)." };
    }
    return { verdict: "PASS", original, note: "Le finding n'a pas été reproduit (corrigé)." };
  } catch (e) {
    return { verdict: "INCONCLUSIVE", original, note: `Retest impossible : ${(e as Error).message}` };
  }
}
