import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../lib/api";
import { formatDate } from "../lib/format";
import { errorMessage } from "../lib/http";
import { keys } from "../lib/queries";
import { useStore } from "../lib/store";
import { Button, Card, EmptyState, ErrorState, Pagination, Skeleton, Tabs } from "../components/ui";
import { DashboardShell } from "../components/dashboard";
import { Footer } from "../components/Layout";
import { Stars } from "../components/Reviews";

/** Avis reçus sur mes événements (identifiants d'événements depuis PostgreSQL, documents depuis MongoDB). */
export function OrganizerReviewsPage() {
  const { toast } = useStore();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"all" | "pending">("pending");
  const [page, setPage] = useState(1);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const sansReponse = tab === "pending";
  const query = useQuery({
    queryKey: keys.organizerReviews(sansReponse, page),
    queryFn: () => api.organizerReviews(sansReponse, page),
    placeholderData: (prev) => prev,
  });
  const reply = useMutation({
    mutationFn: ({ id, texte }: { id: string; texte: string }) => api.replyReview(id, texte),
    onSuccess: () => {
      toast("Réponse publiée", "success");
      void queryClient.invalidateQueries({ queryKey: ["organizer-reviews"] });
    },
    onError: (error) => toast(errorMessage(error), "error"),
  });

  return (
    <>
      <DashboardShell
        title="Avis"
        subtitle={query.data ? `${query.data.total} avis ${sansReponse ? "sans réponse" : "au total"}` : "Chargement…"}
        action={
          <Tabs
            value={tab}
            onChange={(v) => {
              setTab(v as "all" | "pending");
              setPage(1);
            }}
            tabs={[
              { id: "pending", label: "À répondre" },
              { id: "all", label: "Tous" },
            ]}
          />
        }
      >
        {query.isError ? (
          <ErrorState onRetry={() => void query.refetch()} />
        ) : query.isLoading || !query.data ? (
          <Skeleton className="h-40 w-full" />
        ) : query.data.items.length === 0 ? (
          <EmptyState title="Aucun avis" message={sansReponse ? "Tous les avis ont une réponse." : "Vos participants n'ont pas encore laissé d'avis."} />
        ) : (
          <div className="space-y-3" data-testid="organizer-reviews">
            {query.data.items.map((r) => (
              <Card key={r.id} className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Stars note={r.note} />
                    <span className="font-medium">{r.titre ?? "Sans titre"}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {r.evenement} · {r.prenom} · {formatDate(r.createdAt)}
                  </span>
                </div>
                <p className="mt-2 text-sm text-foreground/90">{r.commentaire}</p>
                {r.reponseOrganisateur ? (
                  <p className="mt-2 rounded-[10px] border-l-2 border-primary bg-elevated/60 p-3 text-sm">{r.reponseOrganisateur.texte}</p>
                ) : (
                  <form
                    className="mt-3 flex gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      reply.mutate({ id: r.id, texte: (drafts[r.id] ?? "").trim() });
                    }}
                  >
                    <input
                      value={drafts[r.id] ?? ""}
                      onChange={(e) => setDrafts({ ...drafts, [r.id]: e.target.value })}
                      required
                      maxLength={2000}
                      placeholder="Répondre publiquement"
                      className="flex-1 rounded-[10px] border border-border bg-background px-3 py-2 text-sm"
                    />
                    <Button type="submit" size="sm" disabled={reply.isPending || !(drafts[r.id] ?? "").trim()}>
                      Répondre
                    </Button>
                  </form>
                )}
              </Card>
            ))}
            <Pagination page={page} totalPages={query.data.totalPages} onChange={setPage} />
          </div>
        )}
      </DashboardShell>
      <Footer />
    </>
  );
}
