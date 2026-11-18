import { useMutation } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useQueryParams } from "../lib/hooks";
import { errorMessage } from "../lib/http";
import { useStore } from "../lib/store";
import { formatDateTime } from "../lib/format";
import { useRouter } from "../lib/router";
import { HoldCountdown } from "../components/HoldCountdown";
import { Button, Card, EmptyState, Link } from "../components/ui";
import { IconClock } from "../components/icons";
import { Footer, Page } from "../components/Layout";

// Pas de confirmation possible ici : seul l'organisateur de l'événement (ou un
// administrateur) valide un virement, une fois les fonds reçus. La réservation
// expire d'elle-même si elle n'est pas validée avant expireA.
export function AwaitingTransferPage() {
  const params = useQueryParams();
  const { navigate } = useRouter();
  const reservationId = Number(params.get("reservation"));
  const expireA = params.get("expireA");
  const montant = params.get("montant");
  const event = params.get("event");
  const tarif = params.get("tarif");
  const quantite = params.get("quantite");
  const { toast } = useStore();
  const cancel = useMutation({
    mutationFn: () => api.cancelHold(reservationId),
    onSuccess: () => {
      toast("Réservation annulée, les places sont libérées", "info");
      navigate("/events");
    },
    onError: (error) => toast(errorMessage(error), "error"),
  });

  if (!Number.isInteger(reservationId) || reservationId <= 0 || !expireA)
    return (
      <>
        <Page>
          <div className="pt-16">
            <EmptyState
              title="Aucune réservation en attente"
              message="Retrouvez vos achats dans « Mes billets »."
              action={<Button onClick={() => navigate("/tickets")}>Mes billets</Button>}
            />
          </div>
        </Page>
        <Footer />
      </>
    );

  return (
    <>
      <Page>
        <div className="mx-auto max-w-lg pt-16 text-center">
          <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-primary/15 text-primary animate-fade-up">
            <IconClock className="size-8" />
          </div>
          <h1 className="mt-6 font-display text-4xl font-extrabold tracking-tight">En attente de virement</h1>
          <p className="mt-2 text-muted-foreground">
            Vos places sont réservées le temps de recevoir votre virement. Effectuez-le avant la date limite ci-dessous, sinon la
            réservation expire automatiquement et les places redeviennent disponibles.
          </p>
        </div>

        <div className="mx-auto mt-8 max-w-lg space-y-4">
          <Card className="p-5">
            <div className="grid gap-2 text-sm">
              {event && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Événement</span>
                  <span className="font-medium">{event}</span>
                </div>
              )}
              {tarif && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Billets</span>
                  <span>
                    {quantite ?? 1} × {tarif}
                  </span>
                </div>
              )}
              {montant && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Montant du virement</span>
                  <span className="font-display font-semibold">{montant} €</span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Réservation</span>
                <span className="font-mono text-xs">n° {reservationId}</span>
              </div>
            </div>
            <div className="mt-4 border-t border-border pt-4">
              <HoldCountdown expireA={expireA} onExpire={() => navigate("/tickets")} />
              <p className="mt-1 text-xs text-muted-foreground">Date limite : {formatDateTime(expireA)}</p>
            </div>
          </Card>

          <p className="text-center text-xs text-muted-foreground">
            La confirmation du virement est traitée manuellement par l'organisateur ; vous recevrez vos billets une fois le
            paiement rapproché.
          </p>
        </div>

        <div className="mx-auto mt-8 flex max-w-lg flex-wrap justify-center gap-3">
          <Link to="/tickets">
            <Button variant="outline">Voir mes billets</Button>
          </Link>
          <Button variant="ghost" loading={cancel.isPending} onClick={() => cancel.mutate()}>
            Annuler la réservation
          </Button>
        </div>
      </Page>
      <Footer />
    </>
  );
}
