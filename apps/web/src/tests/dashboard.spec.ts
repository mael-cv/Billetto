import { describe, expect, it } from "vitest";
import { fillDays, lastDays } from "../pages/OrganizerDashboard";
import type { DailySales } from "../lib/types";

describe("pages/OrganizerDashboard helpers", () => {
  describe("lastDays", () => {
    it("renvoie une plage from/to cohérente", () => {
      const range = lastDays(7);
      const from = new Date(range.from);
      const to = new Date(range.to);
      expect(to.getTime()).toBeGreaterThan(from.getTime());
      const diffDays = Math.round((to.getTime() - from.getTime()) / (24 * 3600 * 1000));
      expect(diffDays).toBe(8); // n + 1 jours pour inclure aujourd'hui
    });
  });

  describe("fillDays", () => {
    it("comble les jours manquants avec des zéros", () => {
      const from = "2026-09-10T00:00:00.000Z";
      const to = "2026-09-13T00:00:00.000Z";
      const rows: DailySales[] = [
        {
          jour: "2026-09-11",
          commandes: 2,
          billets: 5,
          chiffreAffaires: "150.00",
        },
      ];

      const filled = fillDays(rows, from, to);
      expect(filled).toHaveLength(3); // 10, 11, 12

      expect(filled[0].jour).toBe("2026-09-10");
      expect(filled[0].billets).toBe(0);
      expect(filled[0].chiffreAffaires).toBe("0.00");

      expect(filled[1].jour).toBe("2026-09-11");
      expect(filled[1].billets).toBe(5);
      expect(filled[1].chiffreAffaires).toBe("150.00");

      expect(filled[2].jour).toBe("2026-09-12");
      expect(filled[2].billets).toBe(0);
    });
  });
});
