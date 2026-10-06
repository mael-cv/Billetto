/** Représentation des routes découvertes (runtime + code). */

export interface RouteParam {
  name: string;
  in: "path" | "query" | "body";
  example?: string | number;
}

export interface Route {
  method: string;
  /** Chemin templatisé, ex. /api/v1/orders/:id */
  path: string;
  params: RouteParam[];
  authRequired?: boolean;
  /** Rôles requis d'après le code (ex. ["admin"], ["organizer","admin"]). */
  roles?: string[];
  /** Dernier status observé (probe anonyme). */
  status?: number;
  responseType?: string;
  responseSize?: number;
  latencyMs?: number;
  setCookies?: string[];
  /** Origine : documentée, probée, ou dérivée du code. */
  origins: Array<"documented" | "probed" | "code">;
  /** Lien vers le code (corrélation). */
  handler?: { file: string; line: number };
}

export class RouteModel {
  private readonly routes = new Map<string, Route>();

  private key(method: string, path: string): string {
    return `${method.toUpperCase()} ${path}`;
  }

  add(route: Route): Route {
    const k = this.key(route.method, route.path);
    const existing = this.routes.get(k);
    if (existing) {
      // Fusion des origines et métadonnées.
      for (const o of route.origins) {
        if (!existing.origins.includes(o)) existing.origins.push(o);
      }
      existing.authRequired = existing.authRequired ?? route.authRequired;
      existing.roles = existing.roles ?? route.roles;
      existing.handler = existing.handler ?? route.handler;
      if (route.status !== undefined) existing.status = route.status;
      if (route.params.length > existing.params.length) existing.params = route.params;
      return existing;
    }
    this.routes.set(k, route);
    return route;
  }

  all(): Route[] {
    return [...this.routes.values()];
  }

  byMethod(method: string): Route[] {
    return this.all().filter((r) => r.method.toUpperCase() === method.toUpperCase());
  }

  find(method: string, path: string): Route | undefined {
    return this.routes.get(this.key(method, path));
  }

  mutating(): Route[] {
    return this.all().filter((r) => ["POST", "PUT", "PATCH", "DELETE"].includes(r.method.toUpperCase()));
  }

  size(): number {
    return this.routes.size;
  }
}
