/** Logger minimal, sans dépendance, qui n'écrit jamais de secret. */

export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

const LEVELS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 99,
};

export class Logger {
  constructor(private level: LogLevel = "info") {}

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  private enabled(level: Exclude<LogLevel, "silent">): boolean {
    return LEVELS[level] >= LEVELS[this.level];
  }

  debug(msg: string): void {
    if (this.enabled("debug")) process.stderr.write(`  · ${msg}\n`);
  }
  info(msg: string): void {
    if (this.enabled("info")) process.stderr.write(`${msg}\n`);
  }
  warn(msg: string): void {
    if (this.enabled("warn")) process.stderr.write(`⚠ ${msg}\n`);
  }
  error(msg: string): void {
    if (this.enabled("error")) process.stderr.write(`✗ ${msg}\n`);
  }
  step(msg: string): void {
    if (this.enabled("info")) process.stderr.write(`▸ ${msg}\n`);
  }
}

export const log = new Logger();
