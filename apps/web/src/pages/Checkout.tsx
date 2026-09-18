import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { ApiError, errorMessage } from "../lib/http";
import { formatDate, formatEUR, formatTime } from "../lib/format";
import { useRouter } from "../lib/router";
import { useStore } from "../lib/store";
import { Alert, Button, Card, EmptyState, Link } from "../components/ui";
import { QuantitySelector } from "../components/QuantitySelector";
import { IconShield } from "../components/icons";
import { Footer, Page } from "../components/Layout";

const checkoutSchema = z.object({
  cgv: z.literal(true, { error: "Vous devez accepter les conditions de vente" }),
});
type CheckoutForm = z.infer<typeof checkoutSchema>;

export function CheckoutPage() {
  const { navigate } = useRouter();
  const { cart, setCart, toast } = useStore();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const form = useForm<CheckoutForm>({ resolver: zodResolver(checkoutSchema) });

  // Aucun calcul métier ici : acheter_billet() vérifie tarif, période, quota et
  // calcule le montant. Le total affiché avant paiement est indicatif.
  const purchase = useMutation({
    mutationFn: () => api.purchase(cart!.tarifId, cart!.quantite),
    onSuccess: (result) => {
      const slug = cart?.eventSlug;
      setCart(null);
      void queryClient.invalidateQueries({ queryKey: ["me"] });
      if (slug) void queryClient.invalidateQueries({ queryKey: ["event", slug] });
      toast("Paiement accepté, vos billets sont prêts", "success");
      navigate(`/checkout/success?commande=${result.commandeId}`);
    },
    onError: (error) => {
      if (error instanceof ApiError && cart) {
        void queryClient.invalidateQueries({ queryKey: ["event", cart.eventSlug] });
      }
    },
  });

  if (!cart)
    return (
      <>
        <Page>
          <div className="pt-16">
            <EmptyState
              title="Votre panier est vide"
              message="Choisissez des billets depuis une page événement pour continuer."
              action={<Button onClick={() => navigate("/events")}>Découvrir les événements</Button>}
            />
          </div>
        </Page>
        <Footer />
      </>
    );

  const total = Number(cart.prix) * cart.quantite;
  const error = purchase.error;
  const sellOut = error instanceof ApiError && error.code === "QUOTA_EPUISE";

  return (
    <>
      <Page wide>
        <div className="pt-10">
          <Link to={`/events/${cart.eventSlug}`} className="text-sm text-muted-foreground hover:text-foreground">
            ← Retour à l'événement
          </Link>
          <h1 className="mt-3 font-display text-4xl font-extrabold tracking-tight">Paiement</h1>
        </div>

        <form onSubmit={form.handleSubmit(() => purchase.mutate())} className="mt-8 grid gap-8 lg:grid-cols-[1fr_400px]" noValidate>
          <div className="space-y-8">
            <section>
              <h2 className="mb-4 font-display text-lg font-semibold">Vos billets</h2>
              <Card className="flex flex-wrap items-center gap-4 p-4">
                <div className="size-16 shrink-0 overflow-hidden rounded-[10px] bg-elevated">
                  <img src={cart.eventImage} alt="" className="size-full object-cover" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{cart.eventNom}</div>
                  <div className="text-sm text-muted-foreground">
                    {formatDate(cart.eventDebut)} · {formatTime(cart.eventDebut)} · {cart.lieu}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {cart.tarifNom} · {formatEUR(cart.prix)}
                  </div>
                </div>
                <QuantitySelector
                  value={cart.quantite}
                  min={0}
                  max={Math.min(10, cart.restantes)}
                  disabled={purchase.isPending}
                  onChange={(q) => {
                    purchase.reset();
                    setCart(q === 0 ? null : { ...cart, quantite: q });
                  }}
                />
                <div className="w-24 text-right font-display font-semibold tabular-nums">{formatEUR(total)}</div>
              </Card>
            </section>

            <section>
              <h2 className="mb-4 font-display text-lg font-semibold">Acheteur</h2>
              <Card className="grid gap-1 p-5 text-sm">
                <div className="font-medium">
                  {user?.prenom} {user?.nom}
                </div>
                <div className="text-muted-foreground">{user?.email}</div>
                <p className="mt-2 text-xs text-muted-foreground">Les billets sont nominatifs et rattachés à votre compte.</p>
              </Card>
            </section>

            <section>
              <h2 className="mb-4 font-display text-lg font-semibold">Paiement</h2>
              <Card className="flex items-start gap-3 p-5 text-sm">
                <IconShield className="mt-0.5 size-5 shrink-0 text-success" />
                <div>
                  <div className="font-medium">Paiement simulé</div>
                  <p className="mt-1 text-muted-foreground">
                    Environnement de démonstration : aucune donnée bancaire n'est demandée. La commande, le paiement et les
                    billets sont créés ensemble, dans une seule transaction PostgreSQL.
                  </p>
                </div>
              </Card>
            </section>
          </div>

          <aside>
            <div className="sticky top-24 space-y-4">
              <Card className="p-5">
                <h2 className="font-display text-lg font-semibold">Récapitulatif</h2>
                <div className="mt-4 space-y-2.5 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">
                      {cart.quantite} × {cart.tarifNom}
                    </span>
                    <span className="tabular-nums">{formatEUR(total)}</span>
                  </div>
                  <div className="my-3 border-t border-border" />
                  <div className="flex items-center justify-between">
                    <span className="font-display text-base font-semibold">Total</span>
                    <span className="font-display text-xl font-bold" data-testid="checkout-total">
                      {formatEUR(total)}
                    </span>
                  </div>
                </div>

                <label htmlFor="cgv" className="mt-5 flex cursor-pointer items-start gap-2.5">
                  <input id="cgv" type="checkbox" {...form.register("cgv")} className="mt-0.5 size-4 shrink-0 accent-[#d6ff3f]" />
                  <span className="text-sm text-muted-foreground">
                    J'accepte les conditions générales de vente et la politique de remboursement.
                  </span>
                </label>
                {form.formState.errors.cgv && (
                  <p className="mt-1 text-xs text-danger" role="alert">
                    {form.formState.errors.cgv.message}
                  </p>
                )}

                {error && (
                  <div className="mt-4">
                    <Alert>
                      {errorMessage(error)}
                      {sellOut && (
                        <>
                          {" "}
                          <Link to={`/events/${cart.eventSlug}`} className="underline">
                            Voir les places restantes
                          </Link>
                        </>
                      )}
                    </Alert>
                  </div>
                )}

                <Button type="submit" size="lg" className="mt-5 w-full" loading={purchase.isPending}>
                  {purchase.isPending ? "Paiement en cours…" : `Payer ${formatEUR(total)}`}
                </Button>
                <p className="mt-3 text-center text-xs text-muted-foreground">
                  Remboursement possible jusqu'au début de l'événement.
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
