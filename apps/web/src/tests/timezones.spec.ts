import { describe, expect, it } from "vitest";
import { eventTimeZone, formatDate, formatEventTime, formatTime, zonedTimeToIso, zoneLabel } from "../lib/format";
import { cancellationOpen } from "../lib/presentation";

// 20:00 à Paris le 1er novembre 2026 (heure d'hiver, UTC+1) = 19:00 UTC.
const PARIS_20H_HIVER = "2026-11-01T19:00:00.000Z";
// 20:00 à Paris le 1er juillet 2026 (heure d'été, UTC+2) = 18:00 UTC.
const PARIS_20H_ETE = "2026-07-01T18:00:00.000Z";

describe("fuseaux horaires", () => {
  it("instant UTC affiché dans le fuseau demandé", () => {
    expect(formatTime(PARIS_20H_HIVER, "Europe/Paris")).toBe("20:00");
    expect(formatTime(PARIS_20H_HIVER, "America/New_York")).toBe("14:00");
    expect(formatTime(PARIS_20H_HIVER, "Asia/Tokyo")).toBe("04:00");
    // Tokyo est déjà le lendemain.
    expect(formatDate(PARIS_20H_HIVER, "Asia/Tokyo")).toContain("2 novembre");
  });

  it("heure saisie dans le fuseau de l'événement → instant UTC (heure d'été et d'hiver)", () => {
    expect(zonedTimeToIso("2026-11-01", "20:00", "Europe/Paris")).toBe(PARIS_20H_HIVER);
    expect(zonedTimeToIso("2026-07-01", "20:00", "Europe/Paris")).toBe(PARIS_20H_ETE);
    expect(zonedTimeToIso("2026-11-01", "20:00", "America/New_York")).toBe("2026-11-02T01:00:00.000Z");
    expect(zonedTimeToIso("2026-11-01", "20:00", "UTC")).toBe("2026-11-01T20:00:00.000Z");
  });

  it("événement physique : heure du lieu, précisée si le visiteur est ailleurs", () => {
    const concert = { enLigne: false, fuseauHoraire: "Europe/Paris" };
    expect(eventTimeZone(concert, "America/New_York")).toBe("Europe/Paris");
    expect(formatEventTime(PARIS_20H_HIVER, concert, "Europe/Paris")).toBe("20:00");
    expect(formatEventTime(PARIS_20H_HIVER, concert, "America/New_York")).toBe("20:00 heure de Paris");
  });

  it("événement en ligne : heure locale du visiteur, avec celle de l'événement", () => {
    const live = { enLigne: true, fuseauHoraire: "America/New_York" };
    expect(eventTimeZone(live, "Europe/Paris")).toBe("Europe/Paris");
    expect(formatEventTime(PARIS_20H_HIVER, live, "Europe/Paris")).toBe("20:00 chez vous (14:00 heure de New York)");
    expect(formatEventTime(PARIS_20H_HIVER, live, "America/New_York")).toBe("14:00");
  });

  it("fuseaux différents mais même heure affichée : pas de précision inutile", () => {
    // Lisbonne et Londres ont des noms différents mais la même heure ; Paris a 1 h d'écart.
    const londres = { enLigne: false, fuseauHoraire: "Europe/London" };
    expect(formatEventTime(PARIS_20H_ETE, londres, "Europe/Lisbon")).toBe("19:00");
    expect(formatEventTime(PARIS_20H_ETE, londres, "Europe/Paris")).toBe("19:00 heure de London");
  });

  it("libellé de fuseau lisible", () => {
    expect(zoneLabel("America/New_York")).toBe("New York");
    expect(zoneLabel("UTC")).toBe("UTC");
  });

  it("annulation self-service : ouverte avant l'échéance, fermée après", () => {
    const now = new Date("2026-10-06T12:00:00Z");
    expect(cancellationOpen({ annulationPossibleJusqua: "2026-10-07T00:00:00Z" }, now)).toBe(true);
    expect(cancellationOpen({ annulationPossibleJusqua: "2026-10-06T11:59:00Z" }, now)).toBe(false);
    expect(cancellationOpen({ annulationPossibleJusqua: null }, now)).toBe(true);
  });
});
