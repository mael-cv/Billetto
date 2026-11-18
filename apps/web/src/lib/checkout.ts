import type { CheckoutResult } from "./types";

/** Seule destination de paiement acceptée : la page hébergée par Stripe. */
const PAYMENT_ORIGIN = "https://checkout.stripe.com";

export function isPaymentUrl(url: string): boolean {
  try {
    return new URL(url).origin === PAYMENT_ORIGIN;
  } catch {
    return false;
  }
}

/**
 * Suite d'un POST /orders/holds/:id/checkout : redirection vers la page de
 * paiement, ou page de succès quand il n'y a rien à payer. Le navigateur ne
 * quitte le site que vers l'origine de paiement attendue.
 */
export function followCheckout(
  result: CheckoutResult,
  navigate: (to: string) => void,
  redirect: (url: string) => void = (url) => window.location.assign(url),
): void {
  if (result.statut === "confirmee") {
    navigate(`/checkout/success?commande=${result.commandeId}`);
    return;
  }
  if (!isPaymentUrl(result.url)) throw new Error("Adresse de paiement inattendue");
  redirect(result.url);
}
