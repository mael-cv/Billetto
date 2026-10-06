/**
 * Dérive les routes à partir du code des contrôleurs NestJS (pont vers la
 * corrélation : endpoint ↔ fichier:ligne, et authRequired depuis les décorateurs).
 * Analyse par regex, best-effort — n'échoue jamais si un contrôleur est exotique.
 */

import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { globControllers } from "../whitebox/fs-util";
import type { Route, RouteParam } from "./route-model";

const GLOBAL_PREFIX = "api/v1";

const METHOD_DECORATORS = ["Get", "Post", "Put", "Patch", "Delete", "Options", "Head"];

export interface CodeRoute extends Route {}

export function discoverRoutesFromCode(repoRoot: string): CodeRoute[] {
  const apiSrc = join(repoRoot, "apps", "api", "src");
  const files = globControllers(apiSrc);
  const routes: CodeRoute[] = [];
  for (const file of files) {
    let content: string;
    try {
      content = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    routes.push(...parseController(content, relative(repoRoot, file).replace(/\\/g, "/")));
  }
  return routes;
}

function parseController(content: string, relFile: string): CodeRoute[] {
  const lines = content.split(/\r?\n/);
  const controllerPrefix = extractControllerPrefix(content);
  const classAuthRoles = extractClassAuth(content);

  const out: CodeRoute[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const m = line.match(
      new RegExp(`@(${METHOD_DECORATORS.join("|")})\\(([^)]*)\\)`),
    );
    if (!m) continue;
    const method = (m[1] ?? "").toUpperCase();
    const pathArg = parseStringArg(m[2] ?? "");
    const methodAuth = extractMethodAuth(lines, i);

    const fullPath = buildPath(controllerPrefix, pathArg);
    const authRequired =
      methodAuth.present !== undefined ? methodAuth.present : classAuthRoles !== undefined;
    const roles = methodAuth.roles ?? classAuthRoles;

    out.push({
      method,
      path: fullPath,
      params: extractParams(fullPath),
      authRequired,
      roles: roles && roles.length > 0 ? roles : undefined,
      origins: ["code"],
      handler: { file: relFile, line: i + 1 },
    });
  }
  return out;
}

function extractControllerPrefix(content: string): string {
  const m = content.match(/@Controller\(\s*([^)]*)\)/);
  if (!m) return "";
  return parseStringArg(m[1] ?? "");
}

/** @Authenticated() ou @Authenticated('admin') au niveau classe → auth requis. */
function extractClassAuth(content: string): string[] | undefined {
  // Cherche un @Authenticated juste avant @Controller.
  const idx = content.indexOf("@Controller");
  if (idx < 0) return undefined;
  const before = content.slice(Math.max(0, idx - 200), idx);
  const m = before.match(/@Authenticated\(([^)]*)\)/);
  if (!m) return undefined;
  return parseRoles(m[1] ?? "");
}

function extractMethodAuth(
  lines: string[],
  methodLine: number,
): { present?: boolean; roles?: string[] } {
  // Regarde les ~6 lignes au-dessus du décorateur de route.
  for (let j = methodLine; j >= Math.max(0, methodLine - 6); j--) {
    const l = lines[j] ?? "";
    const m = l.match(/@Authenticated\(([^)]*)\)/);
    if (m) return { present: true, roles: parseRoles(m[1] ?? "") };
  }
  return {};
}

function parseRoles(arg: string): string[] {
  const roles: string[] = [];
  const re = /['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(arg))) roles.push(m[1] ?? "");
  return roles;
}

function parseStringArg(arg: string): string {
  const m = arg.match(/['"]([^'"]*)['"]/);
  return m ? (m[1] ?? "") : "";
}

function buildPath(prefix: string, path: string): string {
  const parts = [GLOBAL_PREFIX, prefix, path]
    .map((p) => p.replace(/^\/+|\/+$/g, ""))
    .filter((p) => p.length > 0);
  return "/" + parts.join("/");
}

function extractParams(path: string): RouteParam[] {
  const params: RouteParam[] = [];
  const re = /:([A-Za-z0-9_]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(path))) {
    params.push({ name: m[1] ?? "", in: "path" });
  }
  return params;
}
