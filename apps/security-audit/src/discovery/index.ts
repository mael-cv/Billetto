/**
 * Phase de reconnaissance : construit le RouteModel en combinant
 *  - les routes dérivées du code (si repo dispo),
 *  - le sondage runtime des racines et chemins courants,
 *  - l'observation des réponses (status, taille, latence, cookies).
 */

import { RouteModel, type Route } from "./route-model";
import { discoverRoutesFromCode } from "./from-code";
import type { HttpClient } from "../core/http-client";
import type { Logger } from "../core/logger";
import type { SessionManager } from "../core/sessions";

/** Chemins courants à sonder (racines, debug, doc). Jamais supposés existants. */
export const COMMON_PATHS = [
  "/",
  "/api",
  "/api/v1",
  "/api/v2",
  "/admin",
  "/internal",
  "/debug",
  "/dev",
  "/test",
  "/health",
  "/metrics",
  "/status",
  "/swagger",
  "/openapi",
  "/openapi.json",
  "/graphql",
  "/playground",
  "/.env",
  "/actuator",
];

export interface DiscoveryInput {
  http: HttpClient;
  sessions: SessionManager;
  baseUrl: string;
  origin: string; // schéma+host+port, sans /api/v1
  repoRoot?: string;
  logger: Logger;
  /** Routes documentées fournies par la config (si le code n'est pas analysable). */
  documentedRoutes?: Array<{ method: string; path: string; authRequired?: boolean; roles?: string[] }>;
}

export async function runDiscovery(input: DiscoveryInput): Promise<RouteModel> {
  const model = new RouteModel();

  // 0. Routes documentées (config).
  for (const r of input.documentedRoutes ?? []) {
    model.add({
      method: r.method.toUpperCase(),
      path: r.path,
      params: paramsOf(r.path),
      authRequired: r.authRequired,
      roles: r.roles,
      origins: ["documented"],
    });
  }

  // 1. Routes du code (corrélation + couverture d'énumération).
  if (input.repoRoot) {
    try {
      const codeRoutes = discoverRoutesFromCode(input.repoRoot);
      for (const r of codeRoutes) model.add(r);
      input.logger.debug(`routes dérivées du code : ${codeRoutes.length}`);
    } catch (e) {
      input.logger.debug(`discovery from-code ignorée : ${(e as Error).message}`);
    }
  }

  // 2. Sondage des chemins courants (origin, pas base/api/v1).
  const anon = input.sessions.anon();
  for (const p of COMMON_PATHS) {
    const url = `${input.origin}${p}`;
    try {
      const res = await input.http.request({
        method: "GET",
        url,
        cookieJar: anon.jar,
        uncounted: true,
      });
      // Enregistre seulement les chemins qui existent (pas 404).
      if (res.status !== 404) {
        model.add(mkRoute("GET", p, res.status, res));
      }
    } catch {
      /* injoignable : ignore */
    }
  }

  // 3. Observe le status anonyme des routes connues (GET uniquement en discovery).
  for (const route of model.byMethod("GET")) {
    if (route.status !== undefined) continue;
    const url = urlForRoute(input, route);
    if (!url) continue;
    try {
      const res = await input.http.request({
        method: "GET",
        url,
        cookieJar: anon.jar,
        uncounted: true,
      });
      route.status = res.status;
      route.responseType = res.headers["content-type"];
      route.responseSize = res.bodyBytes;
      route.latencyMs = res.latencyMs;
    } catch {
      /* ignore */
    }
  }

  input.logger.step(`Discovery : ${model.size()} routes (code + sondage).`);
  return model;
}

function mkRoute(method: string, path: string, status: number, res: { bodyBytes: number; latencyMs: number; headers: Record<string, string> }): Route {
  return {
    method,
    path,
    params: [],
    status,
    responseType: res.headers["content-type"],
    responseSize: res.bodyBytes,
    latencyMs: res.latencyMs,
    origins: ["probed"],
  };
}

/** Construit une URL concrète pour une route, en substituant des IDs plausibles. */
export function urlForRoute(
  input: { origin: string; baseUrl: string },
  route: Route,
  substitutions: Record<string, string | number> = {},
): string | undefined {
  let path = route.path;
  for (const p of route.params.filter((x) => x.in === "path")) {
    const val = substitutions[p.name] ?? p.example ?? defaultParamValue(p.name);
    path = path.replace(`:${p.name}`, String(val));
  }
  if (path.includes(":")) return undefined; // paramètre non résolu
  // Les routes /api/... sont absolues depuis l'origin.
  return `${input.origin}${path}`;
}

function paramsOf(path: string): Route["params"] {
  const params: Route["params"] = [];
  const re = /:([A-Za-z0-9_]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(path))) params.push({ name: m[1] ?? "", in: "path" });
  return params;
}

function defaultParamValue(name: string): string | number {
  if (/id$/i.test(name)) return 1;
  if (/ref|slug/i.test(name)) return "1";
  if (/uuid/i.test(name)) return "00000000-0000-0000-0000-000000000000";
  return "1";
}
