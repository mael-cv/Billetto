import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../lib/api";
import { errorMessage } from "../lib/http";
import { formatDate, formatTime } from "../lib/format";
import { eventImage } from "../lib/presentation";
import { keys } from "../lib/queries";
import { useRouter } from "../lib/router";
import { useStore } from "../lib/store";
import type { MyTicket } from "../lib/types";
import { Badge, Button, Card, EmptyState, ErrorState, Skeleton, Tabs } from "../components/ui";
import { IconCalendar, IconPin } from "../components/icons";
import { Footer, Page } from "../components/Layout";

// Motif décoratif dérivé du code du billet (pas un vrai QR code).
function CodePattern({ code }: { code: string }) {
  const bits = code.replace(/-/g, "").split("").map((c) => parseInt(c, 16));
  return (
    <div className="grid size-24 shrink-0 grid-cols-7 gap-0.5 rounded-[10px] bg-white p-2" aria-label={`Code ${code}`} role="img">
      {Array.from({ length: 49 }).map((_, i) => (
        <div key={i} className={`rounded-[1px] ${((bits[i % bits.length] ?? 0) + i) % 3 === 0 ? "bg-black" : "bg-transparent"}`} />
      ))}
    </div>
  );
}

type TicketState = "valide" | "passe" | "rembourse" | "annule" | "attente";

function stateOf(t: MyTicket, now = new Date()): TicketState {
  if (t.statutCommande === "refunded") return "rembourse";
  if (t.statutCommande === "cancelled") return "annule";
  if (t.statutCommande === "pending") return "attente";
  return new Date(t.debut) > now ? "valide" : "passe";
}

const STATE_BADGE: Record<TicketState, [tone: "success" | "muted" | "danger" | "warning", label: string]> = {
  valide: ["success", "Valide"],
  passe: ["muted", "Passé"],
  rembourse: ["danger", "Remboursé"],
  annule: ["muted", "Annulé"],
  attente: ["warning", "En attente"],
};

function TicketCard({ t, onRefund, refunding }: { t: MyTicket; onRefund: () => void; refunding: boolean }) {
  const state = stateOf(t);
  const [tone, label] = STATE_BADGE[state];
  return (
    <Card className="animate-fade-up overflow-hidden">
      <div className="flex flex-col sm:flex-row">
        <div className="relative h-32 w-full bg-elevated sm:h-auto sm:w-40">
          <img src={eventImage({ id: t.evenementId, type: { nom: "" } }, 400, 300)} alt="" className="size-full object-cover" />
        </div>
        <div className="flex flex-1 items-center gap-4 p-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={tone}>{label}</Badge>
              <span className="font-mono text-xs text-muted-foreground">{t.tarif}</span>
              <span className="font-mono text-xs text-muted-foreground">Commande n° {t.commandeId}</span>
            </div>
            <h3 className="mt-2 font-display text-lg font-semibold leading-tight">{t.evenement}</h3>
            <div className="mt-2 space-y-1 text-sm text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <IconCalendar className="size-4" /> {formatDate(t.debut)} · {formatTime(t.debut)}
              </div>
              <div className="flex items-center gap-1.5">
                <IconPin className="size-4" /> {t.lieu}, {t.ville}
              </div>
            </div>
            <div className="mt-3 font-mono text-xs text-muted-foreground">{t.code}</div>
            {state === "valide" && (
              <Button variant="danger" size="sm" className="mt-3" onClick={onRefund} loading={refunding}>
                Rembourser la commande
              </Button>
            )}
          </div>
          {state === "valide" && <CodePattern code={t.code} />}
        </div>
      </div>
    </Card>
  );
}

export function TicketsPage() {
  const { navigate } = useRouter();
  const { toast } = useStore();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState("upcoming");
  const tickets = useQuery({ queryKey: keys.myTickets, queryFn: () => api.myTickets(1, 100) });

  const refund = useMutation({
    mutationFn: (commandeId: number) => api.refund(commandeId),
    onSuccess: (order) => {
      toast(`Commande n° ${order.id} remboursée`, "success");
      void queryClient.invalidateQueries({ queryKey: ["me"] });
      void queryClient.invalidateQueries({ queryKey: ["event"] });
    },
    // Règles (statut, événement commencé) appliquées par PostgreSQL : on affiche son refus.
    onError: (error) => toast(errorMessage(error), "error"),
  });

  const all = tickets.data?.items ?? [];
  const upcoming = all.filter((t) => stateOf(t) === "valide" || stateOf(t) === "attente");
  const past = all.filter((t) => !upcoming.includes(t));
  const shown = tab === "upcoming" ? upcoming : past;

  const askRefund = (t: MyTicket) => {
    const count = all.filter((x) => x.commandeId === t.commandeId).length;
    if (window.confirm(`Rembourser la commande n° ${t.commandeId} (${count} billet${count > 1 ? "s" : ""}) ?`)) {
      refund.mutate(t.commandeId);
    }
  };

  return (
    <>
      <Page>
        <div className="pt-10">
          <h1 className="font-display text-4xl font-extrabold tracking-tight">Mes billets</h1>
          <p className="mt-2 text-muted-foreground">Présentez le code du billet à l'entrée de l'événement.</p>
        </div>

        <div className="mt-6">
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { id: "upcoming", label: "À venir", count: upcoming.length },
              { id: "past", label: "Passés et remboursés", count: past.length },
            ]}
          />
        </div>

        <div className="mt-6 space-y-4" data-testid="tickets-list">
          {tickets.isLoading ? (
            Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-36 w-full rounded-[16px]" />)
          ) : tickets.isError ? (
            <ErrorState onRetry={() => void tickets.refetch()} />
          ) : shown.length === 0 ? (
            <EmptyState
              title={tab === "upcoming" ? "Aucun billet à venir" : "Aucun billet passé"}
              message="Vos billets apparaîtront ici après un achat."
              action={<Button onClick={() => navigate("/events")}>Trouver un événement</Button>}
            />
          ) : (
            shown.map((t) => (
              <TicketCard
                key={t.id}
                t={t}
                onRefund={() => askRefund(t)}
                refunding={refund.isPending && refund.variables === t.commandeId}
              />
            ))
          )}
          {tickets.data && tickets.data.total > tickets.data.items.length && (
            <p className="text-center text-sm text-muted-foreground">
              {tickets.data.items.length} billets affichés sur {tickets.data.total}.
            </p>
          )}
        </div>
      </Page>
      <Footer />
    </>
  );
}
