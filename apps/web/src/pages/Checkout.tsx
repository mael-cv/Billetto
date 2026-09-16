import { useState } from "react";
import { purchaseTickets } from "../lib/api";
import { formatEUR } from "../lib/data";
import { useRouter } from "../lib/router";
import { useStore } from "../lib/store";
import { Button, Card, EmptyState, FormField, Input, Link } from "../components/ui";
import { QuantitySelector } from "../components/QuantitySelector";
import { IconShield } from "../components/icons";
import { Footer, Page } from "../components/Layout";

const FEE_RATE = 0.05; // display-only service fee; real amounts come from backend

interface Errors {
  [k: string]: string | undefined;
}

export function CheckoutPage() {
  const { navigate } = useRouter();
  const { cart, setSelection, clearCart, toast } = useStore();
  const [buyer, setBuyer] = useState({ prenom: "", nom: "", email: "" });
  const [card, setCard] = useState({ number: "", exp: "", cvc: "" });
  const [terms, setTerms] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);

  const subtotal = cart.reduce((s, i) => s + i.prix * i.quantite, 0);
  const fees = Math.round(subtotal * FEE_RATE * 100) / 100;
  const total = subtotal + fees;

  const updateQty = (tarifId: string, q: number) => {
    if (q === 0) setSelection(cart.filter((i) => i.tarifId !== tarifId));
    else setSelection(cart.map((i) => (i.tarifId === tarifId ? { ...i, quantite: q } : i)));
  };

  const validate = (): boolean => {
    const e: Errors = {};
    if (!buyer.prenom.trim()) e.prenom = "Prénom requis";
    if (!buyer.nom.trim()) e.nom = "Nom requis";
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(buyer.email)) e.email = "Adresse e-mail invalide";
    if (card.number.replace(/\s/g, "").length < 16) e.number = "Numéro de carte invalide";
    if (!/^\d{2}\/\d{2}$/.test(card.exp)) e.exp = "MM/AA";
    if (card.cvc.length < 3) e.cvc = "CVC invalide";
    if (!terms) e.terms = "Vous devez accepter les conditions";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!validate()) {
      toast("Vérifiez les champs du formulaire", "error");
      return;
    }
    setSubmitting(true);
    try {
      // Delegates entirely to the backend (PostgreSQL acheter_billet). No pricing
      // or inventory logic runs on the client.
      const result = await purchaseTickets({
        eventSlug: cart[0].eventSlug,
        items: cart.map((i) => ({ tarifId: i.tarifId, quantite: i.quantite })),
        buyer,
      });
      const eventNom = cart[0].eventNom;
      clearCart();
      sessionStorage.setItem("billetto:last-order", JSON.stringify({ ...result, eventNom }));
      navigate("/checkout/success");
    } catch {
      toast("Le paiement a échoué. Réessayez.", "error");
      setSubmitting(false);
    }
  };

  if (cart.length === 0)
    return (
      <>
        <Page>
          <div className="pt-16">
            <EmptyState
              title="Votre panier est vide"
              message="Ajoutez des billets depuis une page événement pour continuer."
              action={
                <Button onClick={() => navigate("/events")}>Découvrir les événements</Button>
              }
            />
          </div>
        </Page>
        <Footer />
      </>
    );

  return (
    <>
      <Page wide>
        <div className="pt-10">
          <Link to="/events" className="text-sm text-muted-foreground hover:text-foreground">
            ← Continuer mes achats
          </Link>
          <h1 className="mt-3 font-display text-4xl font-extrabold tracking-tight">Paiement</h1>
        </div>

        <form onSubmit={submit} className="mt-8 grid gap-8 lg:grid-cols-[1fr_400px]">
          <div className="space-y-8">
            <section>
              <h2 className="mb-4 font-display text-lg font-semibold">Vos billets</h2>
              <Card className="divide-y divide-border">
                {cart.map((i) => (
                  <div key={i.tarifId} className="flex items-center gap-4 p-4">
                    <div className="size-16 shrink-0 overflow-hidden rounded-[10px] bg-elevated">
                      <img src={i.eventImage} alt="" className="size-full object-cover" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{i.eventNom}</div>
                      <div className="text-sm text-muted-foreground">
                        {i.tarifNom} · {formatEUR(i.prix)}
                      </div>
                    </div>
                    <QuantitySelector value={i.quantite} onChange={(q) => updateQty(i.tarifId, q)} min={0} max={8} />
                    <div className="w-20 text-right font-display font-semibold tabular-nums">{formatEUR(i.prix * i.quantite)}</div>
                  </div>
                ))}
              </Card>
            </section>

            <section>
              <h2 className="mb-4 font-display text-lg font-semibold">Vos informations</h2>
              <Card className="grid gap-4 p-5 sm:grid-cols-2">
                <FormField label="Prénom" error={errors.prenom} htmlFor="prenom">
                  <Input id="prenom" value={buyer.prenom} invalid={!!errors.prenom} onChange={(e) => setBuyer({ ...buyer, prenom: e.target.value })} placeholder="Camille" />
                </FormField>
                <FormField label="Nom" error={errors.nom} htmlFor="nom">
                  <Input id="nom" value={buyer.nom} invalid={!!errors.nom} onChange={(e) => setBuyer({ ...buyer, nom: e.target.value })} placeholder="Roux" />
                </FormField>
                <div className="sm:col-span-2">
                  <FormField label="E-mail" error={errors.email} hint="Vos billets seront envoyés à cette adresse" htmlFor="email">
                    <Input id="email" type="email" value={buyer.email} invalid={!!errors.email} onChange={(e) => setBuyer({ ...buyer, email: e.target.value })} placeholder="camille@mail.com" />
                  </FormField>
                </div>
              </Card>
            </section>

            <section>
              <h2 className="mb-4 font-display text-lg font-semibold">Paiement</h2>
              <Card className="grid gap-4 p-5 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <FormField label="Numéro de carte" error={errors.number} htmlFor="cc">
                    <Input
                      id="cc"
                      inputMode="numeric"
                      value={card.number}
                      invalid={!!errors.number}
                      onChange={(e) => {
                        const v = e.target.value.replace(/\D/g, "").slice(0, 16).replace(/(.{4})/g, "$1 ").trim();
                        setCard({ ...card, number: v });
                      }}
                      placeholder="4242 4242 4242 4242"
                    />
                  </FormField>
                </div>
                <FormField label="Expiration" error={errors.exp} htmlFor="exp">
                  <Input
                    id="exp"
                    value={card.exp}
                    invalid={!!errors.exp}
                    onChange={(e) => {
                      let v = e.target.value.replace(/\D/g, "").slice(0, 4);
                      if (v.length >= 3) v = v.slice(0, 2) + "/" + v.slice(2);
                      setCard({ ...card, exp: v });
                    }}
                    placeholder="MM/AA"
                  />
                </FormField>
                <FormField label="CVC" error={errors.cvc} htmlFor="cvc">
                  <Input id="cvc" inputMode="numeric" value={card.cvc} invalid={!!errors.cvc} onChange={(e) => setCard({ ...card, cvc: e.target.value.replace(/\D/g, "").slice(0, 4) })} placeholder="123" />
                </FormField>
                <div className="sm:col-span-2 flex items-center gap-2 rounded-[10px] border border-border bg-background px-3.5 py-3 text-sm text-muted-foreground">
                  <IconShield className="size-4 text-success" />
                  Vos données de paiement sont chiffrées. Aucune donnée de carte n'est stockée.
                </div>
              </Card>
            </section>
          </div>

          <aside>
            <div className="sticky top-24 space-y-4">
              <Card className="p-5">
                <h2 className="font-display text-lg font-semibold">Récapitulatif</h2>
                <div className="mt-4 space-y-2.5 text-sm">
                  <Row label="Sous-total" value={formatEUR(subtotal)} />
                  <Row label="Frais de service" value={formatEUR(fees)} />
                  <div className="my-3 border-t border-border" />
                  <div className="flex items-center justify-between">
                    <span className="font-display text-base font-semibold">Total</span>
                    <span className="font-display text-xl font-bold">{formatEUR(total)}</span>
                  </div>
                </div>

                <label className="mt-5 flex cursor-pointer items-start gap-2.5">
                  <input
                    type="checkbox"
                    checked={terms}
                    onChange={(e) => setTerms(e.target.checked)}
                    className="mt-0.5 size-4 shrink-0 accent-[#d6ff3f]"
                  />
                  <span className="text-sm text-muted-foreground">
                    J'accepte les conditions générales de vente et la politique de remboursement.
                  </span>
                </label>
                {errors.terms && <p className="mt-1 text-xs text-danger">{errors.terms}</p>}

                <Button type="submit" size="lg" className="mt-5 w-full" loading={submitting}>
                  {submitting ? "Paiement en cours…" : `Payer ${formatEUR(total)}`}
                </Button>
                <p className="mt-3 text-center text-xs text-muted-foreground">
                  En cas d'annulation de l'événement, vous êtes remboursé automatiquement.
                </p>
              </Card>
            </div>
          </aside>
        </form>
      </Page>
      <Footer />
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
