/** Registre de couverture : statut par catégorie + calcul du pourcentage honnête. */

import type { Category } from "./finding";

export type CoverageStatus =
  | "TESTED"
  | "NOT_TESTED"
  | "NOT_APPLICABLE"
  | "INCONCLUSIVE";

export interface CoverageEntry {
  category: Category;
  status: CoverageStatus;
  note?: string;
}

export class CoverageRegistry {
  private readonly entries = new Map<Category, CoverageEntry>();

  set(category: Category, status: CoverageStatus, note?: string): void {
    // Un TESTED ne doit pas être écrasé par un NOT_TESTED tardif.
    const existing = this.entries.get(category);
    if (existing && rank(existing.status) >= rank(status)) {
      if (note && !existing.note) existing.note = note;
      return;
    }
    this.entries.set(category, { category, status, note });
  }

  get(category: Category): CoverageEntry | undefined {
    return this.entries.get(category);
  }

  all(): CoverageEntry[] {
    return [...this.entries.values()].sort((a, b) =>
      a.category.localeCompare(b.category),
    );
  }

  /** Couverture = testées / (testées + non testées + inconclusives). N/A exclu. */
  percent(): number {
    const relevant = this.all().filter((e) => e.status !== "NOT_APPLICABLE");
    if (relevant.length === 0) return 0;
    const tested = relevant.filter((e) => e.status === "TESTED").length;
    return Math.round((tested / relevant.length) * 100);
  }

  counts(): Record<CoverageStatus, number> {
    const acc: Record<CoverageStatus, number> = {
      TESTED: 0,
      NOT_TESTED: 0,
      NOT_APPLICABLE: 0,
      INCONCLUSIVE: 0,
    };
    for (const e of this.all()) acc[e.status] += 1;
    return acc;
  }
}

/** Ordre de priorité : TESTED > INCONCLUSIVE > NOT_APPLICABLE > NOT_TESTED. */
function rank(s: CoverageStatus): number {
  switch (s) {
    case "TESTED":
      return 3;
    case "INCONCLUSIVE":
      return 2;
    case "NOT_APPLICABLE":
      return 1;
    case "NOT_TESTED":
      return 0;
  }
}
