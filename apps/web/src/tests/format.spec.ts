import { describe, expect, it } from "vitest";
import {
  formatDate,
  formatDateShort,
  formatDateTime,
  formatEUR,
  formatNumber,
  formatPercent,
  formatTime,
  slugify,
} from "../lib/format";

describe("lib/format", () => {
  describe("formatEUR", () => {
    it("formate des entiers sans décimales inutiles", () => {
      const res = formatEUR(25);
      // Espace insécable ou normal selon locale
      expect(res.replace(/\s/g, " ")).toBe("25 €");
    });

    it("formate des nombres décimaux avec 2 chiffres après la virgule", () => {
      const res = formatEUR("25.50");
      expect(res.replace(/\s/g, " ")).toBe("25,50 €");
    });

    it("gère les valeurs nulles ou absentes", () => {
      const res = formatEUR(null);
      expect(res.replace(/\s/g, " ")).toBe("0 €");
    });
  });

  describe("formatDate, formatTime, formatDateTime, formatDateShort", () => {
    const iso = "2026-09-16T20:00:00.000Z";

    it("formate la date en français", () => {
      const res = formatDate(iso);
      expect(res).toContain("2026");
      expect(res).toContain("16");
    });

    it("formate l'heure au fuseau Europe/Paris", () => {
      const res = formatTime(iso);
      // 20:00 UTC = 22:00 heure d'été à Paris
      expect(res).toMatch(/22:00/);
    });

    it("formate date et heure complètes", () => {
      const res = formatDateTime(iso);
      expect(res).toContain("16/09/2026");
      expect(res).toContain("22:00");
    });

    it("fournit jour et mois court en majuscules", () => {
      const res = formatDateShort(iso);
      expect(res.jour).toBe("16");
      expect(res.mois).toBe("SEPT");
    });
  });

  describe("formatNumber & formatPercent", () => {
    it("formate les nombres avec séparateur de milliers", () => {
      const res = formatNumber(1800000);
      expect(res.replace(/\s/g, " ")).toMatch(/1 800 000|1800000/);
    });

    it("formate les pourcentages arrondis", () => {
      expect(formatPercent(0.854)).toBe("85 %");
      expect(formatPercent(1)).toBe("100 %");
      expect(formatPercent(null)).toBe("—");
    });
  });

  describe("slugify", () => {
    it("nettoie les accents et caractères spéciaux", () => {
      expect(slugify("Concert d'été à Paris !")).toBe("concert-d-ete-a-paris");
    });

    it("préfixe les slugs purement numériques pour éviter la collision avec un identifiant", () => {
      expect(slugify("2026")).toBe("evenement-2026");
    });

    it("ajoute un suffixe si spécifié", () => {
      expect(slugify("Festival Rock", "lyon")).toBe("festival-rock-lyon");
    });
  });
});
