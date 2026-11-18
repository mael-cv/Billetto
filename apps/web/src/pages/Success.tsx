import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { followCheckout } from "../lib/checkout";
import { useQueryParams } from "../lib/hooks";
import { formatDate, formatEUR, formatTime } from "../lib/format";
import { errorMessage } from "../lib/http";
import { keys } from "../lib/queries";
import { useRouter } from "../lib/router";
import { useStore } from "../lib/store";
import type { HoldView } from "../lib/types";
import { Alert, Button, Card, EmptyState, ErrorState, Link, Skeleton, Spinner } from "../components/ui";
import { IconCalendar, IconCheck, IconClock, IconTicket } from "../components/icons";
import { Footer, Page } from "../components/Layout";

/** Fichier iCalendar de l'événement (généré localement, aucune donnée envoyée). */
function calendarHref(nom: string, debut: string, lieu: string): string {
  const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const start = new Date(debut);
  const end = new Date(start.getTime() + 3 * 3_600_000);
  // Aucun séparateur ni saut de ligne (CR ou LF) dans une valeur : pas d'injection de propriété.
  const clean = (value: string) => value.replace(/[,;\r\n]/g, " ");
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Billetto//FR",
    "BEGIN:VEVENT",
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${clean(nom)}`,
    `LOCATION:${clean(lieu)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`;
}

const positiveInt = (value: string | null): number | null => {
  const n = Number(value);
  return value !== null && Number.isInteger(n) && n > 0 ? n : null;
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Page>{children}</Page>
      <Footer />
    </>
  );
}

function OrderConfirmed({ id }: { id: number }) {
  const order = useQuery({ queryKey: keys.order(id), queryFn: () => api.order(id) });
  const first = order.data?.billets[0];

  return (
    <Shell>
      <div className="mx-auto max-w-lg pt-16 text-center">
        <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-primary text-primary-foreground animate-fade-up">
          <IconCheck className="size-8" />
        </div>
        <h1 className="mt-6 font-display text-4xl font-extrabold tracking-tight">Commande confirmée</h1>
        <p className="mt-2 text-muted-foreground">Vos billets sont disponibles à tout moment dans « Mes billets ».</p>
        <div className="mt-2 font-mono text-sm text-muted-foreground">
          Commande <span className="text-foreground" data-testid="order-id">n° {id}</span>
          {order.data && <> · {formatEUR(order.data.montantTotal)}</>}
        </div>
      </div>

      <div className="mx-auto mt-10 max-w-lg space-y-3">
        {order.isLoading && Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-[16px]" />)}
        {order.isError && <ErrorState onRetry={() => void order.refetch()} />}
        {order.data?.billets.map((t) => (
          <Card key={t.id} className="flex items-center gap-4 p-4">
            <span className="flex size-11 items-center justify-center rounded-[10px] bg-primary/15 text-primary">
              <IconTicket />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{t.evenement}</div>
              <div className="text-sm text-muted-foreground">
                {t.tarif} · {formatDate(t.debut)} · {formatTime(t.debut)}
              </div>
            </div>
            <span className="hidden font-mono text-xs text-muted-foreground sm:block">{t.code.slice(0, 8).toUpperCase()}</span>
          </Card>
        ))}
      </div>

      <div className="mx-auto mt-8 flex max-w-lg flex-col gap-3 sm:flex-row">
        <Link to="/tickets" className="flex-1">
          <Button className="w-full">Voir mes billets</Button>
        </Link>
        {first && (
          <a href={calendarHref(first.evenement, first.debut, `${first.lieu}, ${first.ville}`)} download="billetto.ics" className="flex-1">
            <Button variant="outline" className="w-full" type="button">
              <IconCalendar className="size-4" /> Ajouter au calendrier
            </Button>
          </a>
        )}
      </div>
    </Shell>
  );
}

/**
 * Retour de la page de paiement. Rien ici ne « valide » le paiement : la page
 * interroge l'API jusqu'à ce que la réservation soit confirmée par le webhook
 * du prestataire, seul habilité à émettre les billets.
 */
function PaymentReturn({ reservationId, cancelled }: { reservationId: number; cancelled: boolean }) {
  const { navigate } = useRouter();
  const { toast } = useStore();
  const queryClient = useQueryClient();
  const hold = useQuery({
    queryKey: keys.hold(reservationId),
    queryFn: () => api.holdStatus(reservationId),
    // Tant que la réservation est active, le paiement peut encore être confirmé.
    refetchInterval: (query) => ((query.state.data as HoldView | undefined)?.statut === "active" ? 2_000 : false),
  });

  const resume = useMutation({
    mutationFn: () => api.checkoutHold(reservationId),
    onSuccess: (result) => followCheckout(result, navigate),
  });
  const cancel = useMutation({
    mutationFn: () => api.cancelHold(reservationId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["event"] });
      toast("Réservation annulée, les places sont libérées", "info");
      navigate("/events");
    },
  });

  if (hold.isLoading)
    return (
      <Shell>
        <div className="flex justify-center pt-24 text-muted-foreground">
          <Spinner className="size-6" />
        </div>
      </Shell>
    );

  if (hold.isError || !hold.data)
    return (
      <Shell>
        <div className="pt-16">
          <EmptyState
            title="Réservation introuvable"
            message="Retrouvez vos achats dans « Mes billets »."
            action={<Button onClick={() => navigate("/tickets")}>Mes billets</Button>}
          />
        </div>
      </Shell>
    );

  const data = hold.data;
  if (data.statut === "confirmee" && data.commandeId !== null) return <OrderConfirmed id={data.commandeId} />;

  if (data.statut !== "active")
    return (
      <Shell>
        <div className="pt-16">
          <EmptyState
            title={data.statut === "annulee" ? "Réservation annulée" : "Réservation expirée"}
            message="Les places ont été remises en vente. Vous pouvez recommencer depuis la page de l'événement."
            action={<Button onClick={() => navigate("/events")}>Voir les événements</Button>}
          />
        </div>
      </Shell>
    );

  const actionError = resume.error ?? cancel.error;
  return (
    <Shell>
      <div className="mx-auto max-w-lg pt-16 text-center" data-testid="payment-pending">
        <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-primary/15 text-primary animate-fade-up">
          <IconClock className="size-8" />
        </div>
        <h1 className="mt-6 font-display text-4xl font-extrabold tracking-tight">
          {cancelled ? "Paiement non finalisé" : "Confirmation du paiement"}
        </h1>
        <p className="mt-2 text-muted-foreground">
          {cancelled
            ? "Vos places restent réservées pendant quelques minutes. Vous pouvez reprendre le paiement ou libérer vos places."
            : "Nous attendons la confirmation de Stripe. Cette page se met à jour toute seule : vos billets apparaîtront dès que le paiement est validé."}
        </p>
      </div>

      <div className="mx-auto mt-8 max-w-lg space-y-4">
        <Card className="grid gap-2 p-5 text-sm">
          {data.evenement && (
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Événement</span>
              <span className="font-medium">{data.evenement}</span>
            </div>
          )}
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Billets</span>
            <span>
              {data.quantite} × {data.tarif ?? "billet"}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Montant</span>
            <span className="font-display font-semibold">{formatEUR(data.montantTotal)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Réservation</span>
            <span className="font-mono text-xs">n° {data.id}</span>
          </div>
        </Card>

        {actionError && <Alert>{errorMessage(actionError)}</Alert>}

        <div className="flex flex-col gap-3 sm:flex-row">
          <Button className="flex-1" loading={resume.isPending || resume.isSuccess} onClick={() => resume.mutate()}>
            {cancelled ? "Reprendre le paiement" : "Rouvrir la page de paiement"}
          </Button>
          <Button variant="outline" className="flex-1" loading={cancel.isPending} onClick={() => cancel.mutate()}>
            Annuler la réservation
          </Button>
        </div>
      </div>
    </Shell>
  );
}

export function SuccessPage() {
  const params = useQueryParams();
  const { navigate } = useRouter();
  const commande = positiveInt(params.get("commande"));
  const reservation = positiveInt(params.get("reservation"));

  if (commande !== null) return <OrderConfirmed id={commande} />;
  if (reservation !== null) return <PaymentReturn reservationId={reservation} cancelled={params.get("retour") === "annule"} />;

  return (
    <Shell>
      <div className="pt-16">
        <EmptyState
          title="Aucune commande"
          message="Retrouvez vos achats dans « Mes billets »."
          action={<Button onClick={() => navigate("/tickets")}>Mes billets</Button>}
        />
      </div>
    </Shell>
  );
}
