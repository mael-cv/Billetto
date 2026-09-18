import { describe, expect, it } from "vitest";
import { ApiError, buildQuery, errorMessage, readCookie } from "../lib/http";

describe("lib/http", () => {
  describe("buildQuery", () => {
    it("renvoie une chaîne vide sans paramètres", () => {
      expect(buildQuery()).toBe("");
      expect(buildQuery({})).toBe("");
    });

    it("ignore les valeurs undefined, null et vides", () => {
      const q = buildQuery({
        page: 1,
        q: "",
        ville: undefined,
        statut: null,
        sort: "date",
      });
      expect(q).toBe("?page=1&sort=date");
    });

    it("encode proprement les valeurs", () => {
      const q = buildQuery({ q: "rock & roll" });
      expect(q).toBe("?q=rock+%26+roll");
    });
  });

  describe("readCookie", () => {
    it("extrait la valeur d'un cookie donné", () => {
      const cookieStr = "foo=bar; billetto_csrf=abc-123; session=xyz";
      expect(readCookie("billetto_csrf", cookieStr)).toBe("abc-123");
      expect(readCookie("foo", cookieStr)).toBe("bar");
    });

    it("renvoie null si le cookie est absent", () => {
      const cookieStr = "foo=bar; test=123";
      expect(readCookie("billetto_csrf", cookieStr)).toBeNull();
    });
  });

  describe("ApiError & errorMessage", () => {
    it("stocke code, statut et détails", () => {
      const err = new ApiError(400, "VALIDATION", "Données invalides", [
        { champ: "email", message: "Email invalide" },
      ]);
      expect(err.status).toBe(400);
      expect(err.code).toBe("VALIDATION");
      expect(err.message).toBe("Données invalides");
      expect(err.details).toHaveLength(1);
    });

    it("fournit le bon message pour ApiError et les autres erreurs", () => {
      const apiErr = new ApiError(404, "NOT_FOUND", "Événement introuvable");
      expect(errorMessage(apiErr)).toBe("Événement introuvable");
      expect(errorMessage(new Error("Boum"))).toBe("Une erreur inattendue est survenue.");
    });
  });
});
