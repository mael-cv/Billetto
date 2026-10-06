/**
 * Corrélation black-box ↔ white-box. Un même problème vu par plusieurs sources
 * devient un finding enrichi (confiance ↑, statut CONFIRMED, source "correlated").
 * On rattache d'abord chaque finding black-box à son handler (fichier:ligne) via
 * le RouteModel, puis on fusionne les groupes multi-sources partageant un CWE.
 */

import { compareSeverity, type Finding } from "../core/finding";
import type { RouteModel } from "../discovery/route-model";

export function attachHandlers(findings: Finding[], routes: RouteModel): Finding[] {
  return findings.map((f) => {
    if (f.location.file || !f.location.endpoint) return f;
    const route = findRoute(routes, f.location.method, f.location.endpoint);
    if (route?.handler) {
      return { ...f, location: { ...f.location, file: route.handler.file, line: route.handler.line } };
    }
    return f;
  });
}

function findRoute(routes: RouteModel, method: string | undefined, endpoint: string) {
  const norm = (p: string) => p.replace(/:[^/]+/g, ":param").replace(/\/+$/, "");
  const target = norm(endpoint);
  return routes.all().find((r) => {
    if (method && r.method.toUpperCase() !== method.toUpperCase()) return false;
    return norm(r.path) === target;
  });
}

export function correlate(findings: Finding[], routes: RouteModel): Finding[] {
  const withHandlers = attachHandlers(findings, routes);

  // Groupe par (cwe, fichier handler) pour repérer les confirmations croisées.
  const groups = new Map<string, Finding[]>();
  const passthrough: Finding[] = [];
  for (const f of withHandlers) {
    const file = f.location.file;
    if (!f.cwe || !file) {
      passthrough.push(f);
      continue;
    }
    const key = `${f.cwe}|${file}`;
    const arr = groups.get(key) ?? [];
    arr.push(f);
    groups.set(key, arr);
  }

  const out: Finding[] = [...passthrough];
  for (const group of groups.values()) {
    if (group.length === 1) {
      out.push(group[0]!);
      continue;
    }
    const sources = new Set(group.map((g) => g.source));
    const crossSource = sources.size > 1 || (sources.has("blackbox") && sources.has("whitebox"));
    if (!crossSource) {
      out.push(...group);
      continue;
    }
    out.push(mergeGroup(group));
  }
  return out;
}

function mergeGroup(group: Finding[]): Finding {
  const winner = [...group].sort((a, b) => compareSeverity(a.severity, b.severity) || b.confidence - a.confidence)[0]!;
  return {
    ...winner,
    source: "correlated",
    status: "CONFIRMED",
    confidence: Math.min(0.99, Math.max(...group.map((g) => g.confidence)) + 0.1),
    evidence: group.flatMap((g) => g.evidence),
    reproduction: winner.reproduction,
    title: `${winner.title} (confirmé black-box + white-box)`,
    references: dedupeStrings(group.flatMap((g) => g.references ?? [])),
  };
}

function dedupeStrings(xs: string[]): string[] | undefined {
  const s = [...new Set(xs)];
  return s.length > 0 ? s : undefined;
}
