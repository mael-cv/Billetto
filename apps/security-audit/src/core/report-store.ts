/** Persistance des findings d'un run pour permettre le retest (--finding SEC-001 --retest). */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Finding } from "./finding";
import type { CoverageEntry } from "./coverage";

export interface StoredRun {
  timestamp: string;
  baseUrl: string;
  profile: string;
  findings: Finding[];
  coverage: CoverageEntry[];
}

const STORE_FILE = ".last-run.json";

export class ReportStore {
  constructor(private readonly dir: string) {}

  save(run: StoredRun): string {
    mkdirSync(this.dir, { recursive: true });
    const path = join(this.dir, STORE_FILE);
    writeFileSync(path, JSON.stringify(run, null, 2), "utf8");
    return path;
  }

  load(): StoredRun | undefined {
    const path = join(this.dir, STORE_FILE);
    if (!existsSync(path)) return undefined;
    try {
      return JSON.parse(readFileSync(path, "utf8")) as StoredRun;
    } catch {
      return undefined;
    }
  }

  findFinding(id: string): Finding | undefined {
    return this.load()?.findings.find((f) => f.id === id);
  }
}
