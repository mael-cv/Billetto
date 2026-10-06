/** Registre des moteurs white-box / infra. */

import type { WhiteboxCheck } from "../core/check";
import { sastCheck } from "./sast";
import { secretsCheck } from "./secrets";
import { dependenciesCheck } from "./dependencies";
import { configurationCheck } from "./configuration";
import { dockerCheck } from "./docker";
import { cicdCheck } from "./cicd";
import { infrastructureCheck } from "./infrastructure";

export const WHITEBOX_CHECKS: WhiteboxCheck[] = [
  sastCheck,
  secretsCheck,
  dependenciesCheck,
  configurationCheck,
  dockerCheck,
  cicdCheck,
  infrastructureCheck,
];

export type WhiteboxEngine = "sast" | "secrets" | "dependencies" | "configuration" | "docker" | "cicd" | "infrastructure";

export function selectWhitebox(enabled?: WhiteboxEngine[]): WhiteboxCheck[] {
  if (!enabled || enabled.length === 0) return WHITEBOX_CHECKS;
  return WHITEBOX_CHECKS.filter((c) => enabled.includes(c.id as WhiteboxEngine));
}
