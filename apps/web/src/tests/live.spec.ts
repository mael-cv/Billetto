import { describe, expect, it } from "vitest";
import { freshness, liveSegments } from "../lib/live";

describe("dashboard live", () => {
  it("jauge : vendu, réservé et libre font 100 %", () => {
    expect(liveSegments({ places: 10, vendus: 3, reserves: 2 })).toEqual({ vendu: 30, reserve: 20, libre: 50 });
  });

  it("jauge bornée à 100 % si le quota a baissé après coup", () => {
    expect(liveSegments({ places: 4, vendus: 3, reserves: 3 })).toEqual({ vendu: 75, reserve: 25, libre: 0 });
    expect(liveSegments({ places: 2, vendus: 5, reserves: 1 })).toEqual({ vendu: 100, reserve: 0, libre: 0 });
  });

  it("jauge vide sans places ; valeurs négatives ignorées", () => {
    expect(liveSegments({ places: 0, vendus: 3, reserves: 1 })).toEqual({ vendu: 0, reserve: 0, libre: 0 });
    expect(liveSegments({ places: 10, vendus: -1, reserves: 0 })).toEqual({ vendu: 0, reserve: 0, libre: 100 });
  });

  it("fraîcheur affichée", () => {
    expect(freshness(10_000, 10_500)).toBe("à l'instant");
    expect(freshness(10_000, 17_000)).toBe("il y a 7 s");
    expect(freshness(0, 185_000)).toBe("il y a 3 min");
  });
});
