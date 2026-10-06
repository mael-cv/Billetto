/**
 * Interface LLM optionnelle. AUCUNE implémentation ne requiert de clé API : le
 * cœur du moteur fonctionne entièrement sans LLM. Les providers « cloud » ne
 * s'activent que si la clé correspondante est déjà présente dans l'environnement.
 */

import type { Finding } from "../core/finding";

export interface ReviewRequest {
  finding: Finding;
  context: string;
}

export interface ReviewSuggestion {
  findingId: string;
  verdict: "likely-real" | "likely-false-positive" | "uncertain";
  rationale: string;
}

export interface LLMProvider {
  readonly name: string;
  available(): boolean;
  review(req: ReviewRequest): Promise<ReviewSuggestion>;
}

/** Provider par défaut : ne fait aucun appel réseau. */
export class NoopProvider implements LLMProvider {
  readonly name = "noop";
  available(): boolean {
    return true;
  }
  async review(req: ReviewRequest): Promise<ReviewSuggestion> {
    return {
      findingId: req.finding.id,
      verdict: "uncertain",
      rationale: "Revue LLM désactivée (mode offline). Fournir l'AI Review Package à un agent pour analyse manuelle.",
    };
  }
}

/**
 * Sélectionne un provider. Ne retourne jamais un provider cloud sans clé déjà
 * présente dans l'environnement (jamais imposée, jamais consommée en CI).
 */
export function selectProvider(): LLMProvider {
  // Les clés ne sont lues que si l'utilisateur les a déjà exportées lui-même.
  // Aucune implémentation cloud n'est livrée activée par défaut.
  return new NoopProvider();
}
