import { describe, expect, it } from "vitest";
import { matchRoute } from "../lib/router";

describe("lib/router", () => {
  describe("matchRoute", () => {
    it("matche une route exacte sans paramètres", () => {
      expect(matchRoute("/events", "/events")).toEqual({});
    });

    it("matche une route paramétrée /events/:slug", () => {
      const match = matchRoute("/events/mon-super-concert", "/events/:slug");
      expect(match).toEqual({ slug: "mon-super-concert" });
    });

    it("décode les paramètres d'URL", () => {
      const match = matchRoute("/events/ete%202026", "/events/:slug");
      expect(match).toEqual({ slug: "ete 2026" });
    });

    it("ignore les query strings", () => {
      const match = matchRoute("/events/mon-concert?tab=tarifs&promo=1", "/events/:slug");
      expect(match).toEqual({ slug: "mon-concert" });
    });

    it("renvoie null si le nombre de segments ne correspond pas", () => {
      expect(matchRoute("/events/a/b", "/events/:slug")).toBeNull();
      expect(matchRoute("/events", "/events/:slug")).toBeNull();
    });

    it("renvoie null si un segment statique ne matche pas", () => {
      expect(matchRoute("/venues/123", "/events/:slug")).toBeNull();
    });
  });
});
