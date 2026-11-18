import { describe, expect, it, vi } from "vitest";
import { followCheckout, isPaymentUrl } from "../lib/checkout";

describe("suite du paiement", () => {
  it("n'accepte que la page de paiement Stripe", () => {
    expect(isPaymentUrl("https://checkout.stripe.com/c/pay/cs_test_abc#fid")).toBe(true);
    expect(isPaymentUrl("http://checkout.stripe.com/c/pay/cs_test_abc")).toBe(false);
    expect(isPaymentUrl("https://checkout.stripe.com.evil.example/c/pay")).toBe(false);
    expect(isPaymentUrl("https://evil.example/?u=https://checkout.stripe.com")).toBe(false);
    expect(isPaymentUrl("javascript:alert(1)")).toBe(false);
    expect(isPaymentUrl("/checkout")).toBe(false);
  });

  it("redirige vers Stripe quand un paiement est dû", () => {
    const navigate = vi.fn();
    const redirect = vi.fn();
    followCheckout({ statut: "paiement", url: "https://checkout.stripe.com/c/pay/cs_test_abc" }, navigate, redirect);
    expect(redirect).toHaveBeenCalledWith("https://checkout.stripe.com/c/pay/cs_test_abc");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("refuse de quitter le site vers une autre origine", () => {
    const navigate = vi.fn();
    const redirect = vi.fn();
    expect(() => followCheckout({ statut: "paiement", url: "https://evil.example/pay" }, navigate, redirect)).toThrow();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("montant nul : page de succès de la commande, sans redirection", () => {
    const navigate = vi.fn();
    const redirect = vi.fn();
    followCheckout({ statut: "confirmee", commandeId: 42, billetIds: [1] }, navigate, redirect);
    expect(navigate).toHaveBeenCalledWith("/checkout/success?commande=42");
    expect(redirect).not.toHaveBeenCalled();
  });
});
