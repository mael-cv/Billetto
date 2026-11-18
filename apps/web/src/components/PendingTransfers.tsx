import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { formatDateTime, formatEUR } from "../lib/format";
import { errorMessage } from "../lib/http";
import { keys } from "../lib/queries";
import { useStore } from "../lib/store";
import type { PendingTransfer } from "../lib/types";
import { Button, Card } from "./ui";

/**
 * Virements attendus sur les événements de l'organisateur. La validation émet
 * les billets : elle n'est proposée qu'ici, et l'API (puis PostgreSQL) vérifie
 * que la réservation concerne bien un événement de l'organisateur connecté.
 */
export function PendingTransfers() {
  const { toast } = useStore();
  const queryClient = useQueryClient();
  const transfers = useQuery({ queryKey: keys.pendingTransfers, queryFn: api.pendingTransfers, refetchInterval: 60_000 });

  const validate = useMutation({
    mutationFn: (transfer: PendingTransfer) => api.validateTransfer(transfer.id),
    onSuccess: (result) => {
      toast(`Virement validé : commande n° ${result.commandeId} créée`, "success");
      void queryClient.invalidateQueries({ queryKey: ["analytics"] });
    },
    onError: (error) => {
      toast(errorMessage(error), "error");
      void queryClient.invalidateQueries({ queryKey: keys.pendingTransfers });
    },
  });

  if (!transfers.data || transfers.data.length === 0) return null;

  return (
    <section data-testid="pending-transfers">
      <h2 className="mb-1 font-display text-lg font-bold">Virements en attente</h2>
      <p className="mb-3 text-sm text-muted-foreground">
        Validez une réservation uniquement après réception des fonds : les billets sont émis immédiatement.
      </p>
      <Card className="divide-y divide-border">
        {transfers.data.map((t) => (
          <div key={t.id} className="flex flex-wrap items-center justify-between gap-3 p-4" data-testid={`transfer-${t.id}`}>
            <div className="min-w-0">
              <div className="truncate font-medium">{t.evenement}</div>
              <p className="text-sm text-muted-foreground">
                Réservation n° {t.id} · {t.quantite} × {t.tarif} · expire le {formatDateTime(t.expireA)}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className="font-display font-semibold tabular-nums">{formatEUR(t.montantTotal)}</span>
              <Button
                size="sm"
                disabled={validate.isPending}
                onClick={() => {
                  if (window.confirm(`Confirmer la réception de ${formatEUR(t.montantTotal)} pour la réservation n° ${t.id} ?`)) {
                    validate.mutate(t);
                  }
                }}
              >
                Valider le virement
              </Button>
            </div>
          </div>
        ))}
      </Card>
    </section>
  );
}
