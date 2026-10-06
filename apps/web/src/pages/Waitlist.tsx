import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { errorMessage } from "../lib/http";
import { useMyWaitlist } from "../lib/queries";
import { useRouter } from "../lib/router";
import { useStore } from "../lib/store";
import type { WaitlistEntry, WaitlistStatus } from "../lib/types";
import { HoldCountdown } from "../components/HoldCountdown";
import { Alert, Badge, Button, Card, EmptyState, ErrorState, Link, Skeleton } from "../components/ui";
import { Footer, Page } from "../components/Layout";

const STATUS: Record<WaitlistStatus, ["success" | "warning" | "danger" | "muted" | "accent", string]> = {
  notifiee: ["success", "Place disponible"],
  en_attente: ["warning", "En attente"],
  confirmee: ["accent", "Billets obtenus"],
  expiree: ["muted", "Offre expirée"],
  annulee: ["muted", "Désinscrit"],
};

// Le délai affiché est indicatif : confirmer_liste_attente revérifie
// l'expiration côté serveur (BT043), et une offre non confirmée passe
// automatiquement à l'inscrit suivant.
export function WaitlistPage() {
  const { navigate } = useRouter();
  const { toast } = useStore();
  const queryClient = useQueryClient();
  const query = useMyWaitlist(true);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["me"] });
    void queryClient.invalidateQueries({ queryKey: ["event"] });
  };

  const confirm = useMutation({
    mutationFn: (entry: WaitlistEntry) => api.confirmWaitlist(entry.id),
    onSuccess: () => {
      toast("Paiement accepté, vos billets sont prêts", "success");
      refresh();
      navigate("/tickets");
    },
    onError: (error) => {
      toast(errorMessage(error), "error");
      refresh();
    },
  });

  const cancel = useMutation({
    mutationFn: (entry: WaitlistEntry) => api.cancelWaitlist(entry.id),
    onSuccess: () => {
      toast("Désinscription enregistrée", "success");
      refresh();
    },
    onError: (error) => toast(errorMessage(error), "error"),
  });

  const entries = query.data ?? [];
  const offers = entries.filter((e) => e.statut === "notifiee");
  const waiting = entries.filter((e) => e.statut === "en_attente");
  const history = entries.filter((e) => e.statut !== "notifiee" && e.statut !== "en_attente");

  return (
    <>
      <Page>
        <div className="pt-10">
          <h1 className="font-display text-4xl font-extrabold tracking-tight">Liste d'attente</h1>
          <p className="mt-2 text-muted-foreground">
            Quand une place se libère, elle est proposée au premier inscrit. Vous avez alors un délai limité pour la
            confirmer ; passé ce délai, elle est proposée à la personne suivante.
          </p>
        </div>

        <div className="mt-8 space-y-6">
          {query.isLoading ? (
            <Skeleton className="h-32 w-full rounded-[16px]" />
          ) : query.isError ? (
            <ErrorState onRetry={() => void query.refetch()} />
          ) : entries.length === 0 ? (
            <EmptyState
              title="Aucune inscription"
              message="Sur un tarif épuisé, inscrivez-vous en liste d'attente depuis la page de l'événement."
              action={<Button onClick={() => navigate("/events")}>Voir les événements</Button>}
            />
          ) : (
            <>
              {offers.map((e) => (
                <Card key={e.id} className="border-primary/50 p-5" data-testid={`waitlist-offer-${e.id}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <Badge tone="success">Une place s'est libérée</Badge>
                      <h2 className="mt-2 font-display text-xl font-bold">{e.evenement}</h2>
                      <p className="text-sm text-muted-foreground">
                        {e.quantite} × {e.tarif}
                      </p>
                    </div>
                  </div>
                  {e.expireA && (
                    <div className="mt-4 border-t border-border pt-4">
                      <HoldCountdown expireA={e.expireA} onExpire={() => void query.refetch()} />
                      <p className="mt-1 text-xs text-muted-foreground">À confirmer avant le {formatDateTime(e.expireA)}</p>
                    </div>
                  )}
                  <div className="mt-4 flex gap-2">
                    <Button onClick={() => confirm.mutate(e)} disabled={confirm.isPending}>
                      Confirmer et payer
                    </Button>
                    <Button variant="outline" onClick={() => cancel.mutate(e)} disabled={cancel.isPending}>
                      Laisser ma place
                    </Button>
                  </div>
                </Card>
              ))}

              {waiting.length > 0 && (
                <Card className="divide-y divide-border">
                  {waiting.map((e) => (
                    <div key={e.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                      <div className="min-w-0">
                        <Link to={`/events/${e.evenementId}`} className="font-medium hover:underline">
                          {e.evenement}
                        </Link>
                        <p className="text-sm text-muted-foreground">
                          {e.quantite} × {e.tarif} · inscrit le {formatDateTime(e.createdAt)}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        {e.position !== null && <Badge tone="warning">Position n° {e.position}</Badge>}
                        <Button variant="outline" size="sm" onClick={() => cancel.mutate(e)} disabled={cancel.isPending}>
                          Se désinscrire
                        </Button>
                      </div>
                    </div>
                  ))}
                </Card>
              )}

              {history.length > 0 && (
                <div>
                  <h2 className="mb-3 font-display text-lg font-bold">Historique</h2>
                  <Card className="divide-y divide-border">
                    {history.map((e) => {
                      const [tone, label] = STATUS[e.statut];
                      return (
                        <div key={e.id} className="flex items-center justify-between gap-3 p-4 text-sm">
                          <span className="min-w-0 truncate">
                            {e.evenement} · {e.quantite} × {e.tarif}
                          </span>
                          <Badge tone={tone}>{label}</Badge>
                        </div>
                      );
                    })}
                  </Card>
                </div>
              )}

              {offers.length === 0 && waiting.length > 0 && (
                <Alert tone="info">Cette page se met à jour automatiquement quand une place vous est proposée.</Alert>
              )}
            </>
          )}
        </div>
      </Page>
      <Footer />
    </>
  );
}
