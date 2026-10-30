import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { formatDate } from "../lib/format";
import { errorMessage } from "../lib/http";
import { keys, useReviews } from "../lib/queries";
import { useRouter } from "../lib/router";
import { useStore } from "../lib/store";
import type { EventDetail, Review, ReviewStats } from "../lib/types";
import { Button, Card, ErrorState, Pagination, Skeleton } from "./ui";

export function Stars({ note, size = "text-base" }: { note: number; size?: string }) {
  return (
    <span className={`${size} tracking-tight text-primary`} aria-label={`${note} sur 5`}>
      {"★".repeat(note)}
      <span className="text-muted-foreground/40">{"★".repeat(5 - note)}</span>
    </span>
  );
}

function StatsPanel({ stats }: { stats: ReviewStats }) {
  const max = Math.max(1, ...Object.values(stats.distribution));
  return (
    <Card className="p-5">
      <div className="flex items-end gap-3">
        <span className="font-display text-4xl font-extrabold" data-testid="reviews-average">
          {stats.moyenne === null ? "—" : stats.moyenne.toFixed(1)}
        </span>
        <div className="pb-1">
          {stats.moyenne !== null && <Stars note={Math.round(stats.moyenne)} />}
          <div className="text-xs text-muted-foreground">
            {stats.nbAvis} avis · {Math.round(stats.tauxReponse * 100)} % avec réponse
          </div>
        </div>
      </div>
      <dl className="mt-4 space-y-1">
        {(["5", "4", "3", "2", "1"] as const).map((n) => (
          <div key={n} className="flex items-center gap-2 text-xs">
            <dt className="w-3 font-mono">{n}</dt>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-elevated">
              <div className="h-full rounded-full bg-primary" style={{ width: `${(stats.distribution[n] / max) * 100}%` }} />
            </div>
            <dd className="w-6 text-right tabular-nums text-muted-foreground">{stats.distribution[n]}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

function ReviewForm({ event, onDone }: { event: EventDetail; onDone: () => void }) {
  const { toast } = useStore();
  const [note, setNote] = useState(5);
  const [titre, setTitre] = useState("");
  const [commentaire, setCommentaire] = useState("");
  const post = useMutation({
    mutationFn: () => api.postReview(event.id, { note, titre: titre.trim() || undefined, commentaire: commentaire.trim() }),
    onSuccess: () => {
      toast("Merci, votre avis est publié", "success");
      onDone();
    },
    onError: (error) => toast(errorMessage(error), "error"),
  });
  return (
    <form
      className="rounded-[16px] border border-border bg-card p-5"
      data-testid="review-form"
      onSubmit={(e) => {
        e.preventDefault();
        post.mutate();
      }}
    >
      <h3 className="font-display font-bold">Votre avis</h3>
      <p className="mt-1 text-xs text-muted-foreground">Réservé aux acheteurs d'un billet (vérifié dans PostgreSQL), un avis par événement.</p>
      <div className="mt-3 flex gap-1" role="radiogroup" aria-label="Note">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={note === n}
            aria-label={`${n} étoile${n > 1 ? "s" : ""}`}
            onClick={() => setNote(n)}
            className={`text-2xl ${n <= note ? "text-primary" : "text-muted-foreground/40"}`}
          >
            ★
          </button>
        ))}
      </div>
      <input
        value={titre}
        onChange={(e) => setTitre(e.target.value)}
        maxLength={120}
        placeholder="Titre (facultatif)"
        className="mt-3 w-full rounded-[10px] border border-border bg-background px-3 py-2 text-sm"
        data-testid="review-title"
      />
      <textarea
        value={commentaire}
        onChange={(e) => setCommentaire(e.target.value)}
        required
        maxLength={2000}
        rows={3}
        placeholder="Votre commentaire"
        className="mt-2 w-full rounded-[10px] border border-border bg-background px-3 py-2 text-sm"
        data-testid="review-comment"
      />
      <Button type="submit" size="sm" className="mt-3" disabled={post.isPending || commentaire.trim().length === 0} data-testid="review-submit">
        Publier
      </Button>
    </form>
  );
}

function ReviewItem({ review, canReply, onChanged }: { review: Review; canReply: boolean; onChanged: () => void }) {
  const { user } = useAuth();
  const { toast } = useStore();
  const [reply, setReply] = useState("");
  const [replying, setReplying] = useState(false);
  const mine = user?.id === review.utilisateurId;
  const remove = useMutation({
    mutationFn: () => api.deleteReview(review.id),
    onSuccess: () => {
      toast("Avis supprimé", "success");
      onChanged();
    },
    onError: (error) => toast(errorMessage(error), "error"),
  });
  const respond = useMutation({
    mutationFn: () => api.replyReview(review.id, reply.trim()),
    onSuccess: () => {
      toast("Réponse publiée", "success");
      setReplying(false);
      onChanged();
    },
    onError: (error) => toast(errorMessage(error), "error"),
  });
  return (
    <article className="rounded-[12px] border border-border bg-card/50 p-4" data-testid="review-item">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Stars note={review.note} />
          {review.titre && <span className="font-medium">{review.titre}</span>}
        </div>
        <span className="text-xs text-muted-foreground">
          {review.prenom} · {formatDate(review.createdAt)}
        </span>
      </div>
      <p className="mt-2 whitespace-pre-line text-sm text-foreground/90">{review.commentaire}</p>
      {review.reponseOrganisateur && (
        <div className="mt-3 rounded-[10px] border-l-2 border-primary bg-elevated/60 p-3 text-sm" data-testid="review-reply">
          <div className="font-mono text-xs uppercase tracking-wide text-muted-foreground">Réponse de l'organisateur</div>
          <p className="mt-1 whitespace-pre-line">{review.reponseOrganisateur.texte}</p>
        </div>
      )}
      <div className="mt-2 flex gap-2">
        {(mine || user?.role === "admin") && (
          <Button variant="ghost" size="sm" onClick={() => remove.mutate()} disabled={remove.isPending}>
            Supprimer
          </Button>
        )}
        {canReply && !review.reponseOrganisateur && !replying && (
          <Button variant="ghost" size="sm" onClick={() => setReplying(true)} data-testid="review-reply-open">
            Répondre
          </Button>
        )}
      </div>
      {replying && (
        <form
          className="mt-2 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            respond.mutate();
          }}
        >
          <input
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            required
            maxLength={2000}
            placeholder="Votre réponse publique"
            className="flex-1 rounded-[10px] border border-border bg-background px-3 py-2 text-sm"
            data-testid="review-reply-input"
          />
          <Button type="submit" size="sm" disabled={respond.isPending || reply.trim().length === 0} data-testid="review-reply-submit">
            Envoyer
          </Button>
        </form>
      )}
    </article>
  );
}

/** Section « Avis » d'un événement : statistiques (pipeline Mongo), liste paginée, formulaire. */
export function ReviewsSection({ event, isOwner }: { event: EventDetail; isOwner: boolean }) {
  const { user } = useAuth();
  const { navigate } = useRouter();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const query = useReviews(event.slug, page);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["reviews", event.slug] });
  const alreadyReviewed = !!user && !!query.data?.items.some((r) => r.utilisateurId === user.id);

  return (
    <section className="mt-10" data-testid="reviews">
      <h2 className="flex items-center gap-2 font-display text-xl font-bold">
        <span>Avis des participants</span>
        <span className="font-mono text-xs font-normal text-muted-foreground">collection MongoDB « avis »</span>
      </h2>
      {query.isError ? (
        <ErrorState onRetry={() => void query.refetch()} />
      ) : query.isLoading || !query.data ? (
        <Skeleton className="mt-4 h-32 w-full" />
      ) : (
        <div className="mt-4 grid gap-4 lg:grid-cols-[260px_1fr]">
          <div className="space-y-4">
            <StatsPanel stats={query.data.stats} />
            {!user ? (
              <Button variant="outline" size="sm" onClick={() => navigate("/login")}>
                Se connecter pour donner un avis
              </Button>
            ) : alreadyReviewed ? (
              <p className="text-xs text-muted-foreground">Vous avez déjà publié un avis sur cet événement.</p>
            ) : (
              <ReviewForm event={event} onDone={refresh} />
            )}
          </div>
          <div className="space-y-3">
            {query.data.items.length === 0 && <p className="text-sm text-muted-foreground">Aucun avis pour le moment.</p>}
            {query.data.items.map((r) => (
              <ReviewItem key={r.id} review={r} canReply={isOwner} onChanged={refresh} />
            ))}
            {query.data.totalPages > 1 && <Pagination page={page} totalPages={query.data.totalPages} onChange={setPage} />}
          </div>
        </div>
      )}
    </section>
  );
}
