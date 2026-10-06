/** Utilitaires de parcours de fichiers, sans dépendance externe. */

import { readdirSync, statSync, existsSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ALWAYS_SKIP = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".cache",
  ".vite",
  "coverage",
  ".turbo",
  ".next",
]);

export interface WalkOptions {
  /** Extensions à inclure (avec le point), ex. [".ts", ".sql"]. Vide = toutes. */
  exts?: string[];
  /** Ignorer les chemins correspondant à ces fragments. */
  skipDirs?: Set<string>;
  /** Respecter un .gitignore simplifié trouvé à la racine. */
  gitignore?: GitignoreMatcher;
  maxFiles?: number;
}

export function walkFiles(root: string, opts: WalkOptions = {}): string[] {
  const out: string[] = [];
  const skip = opts.skipDirs ?? ALWAYS_SKIP;
  const max = opts.maxFiles ?? 50000;

  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (skip.has(name)) continue;
      const full = join(dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      const rel = relative(root, full).split(sep).join("/");
      if (opts.gitignore?.ignores(rel, st.isDirectory())) continue;
      if (st.isDirectory()) {
        stack.push(full);
      } else if (st.isFile()) {
        if (!opts.exts || opts.exts.some((e) => name.endsWith(e))) {
          out.push(full);
          if (out.length >= max) return out;
        }
      }
    }
  }
  return out;
}

/** Trouve les fichiers *.controller.ts sous un répertoire. */
export function globControllers(apiSrc: string): string[] {
  if (!existsSync(apiSrc)) return [];
  return walkFiles(apiSrc, { exts: [".controller.ts"] });
}

/** Matcher .gitignore simplifié : motifs sans négation ni globs complexes. */
export class GitignoreMatcher {
  private readonly patterns: Array<{ neg: boolean; rx: RegExp; dirOnly: boolean }> = [];

  constructor(rules: string[]) {
    for (const raw of rules) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const neg = line.startsWith("!");
      const body = neg ? line.slice(1) : line;
      const dirOnly = body.endsWith("/");
      const clean = body.replace(/\/+$/, "").replace(/^\/+/, "");
      this.patterns.push({ neg, rx: toRegex(clean), dirOnly });
    }
  }

  static fromRepo(root: string): GitignoreMatcher {
    const path = join(root, ".gitignore");
    const rules = existsSync(path) ? readFileSync(path, "utf8").split(/\r?\n/) : [];
    return new GitignoreMatcher(rules);
  }

  ignores(relPath: string, isDir: boolean): boolean {
    let ignored = false;
    const base = relPath.split("/").pop() ?? relPath;
    for (const p of this.patterns) {
      if (p.dirOnly && !isDir) continue;
      if (p.rx.test(relPath) || p.rx.test(base)) {
        ignored = !p.neg;
      }
    }
    return ignored;
  }
}

function toRegex(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "::DOUBLESTAR::")
    .replace(/\*/g, "[^/]*")
    .replace(/::DOUBLESTAR::/g, ".*")
    .replace(/\?/g, "[^/]");
  return new RegExp(`^${escaped}$`);
}

export function readFileSafe(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}
