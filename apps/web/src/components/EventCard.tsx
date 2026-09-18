import { formatDateShort, formatEUR } from "../lib/format";
import { eventImage } from "../lib/presentation";
import type { EventSummary } from "../lib/types";
import { Link } from "./ui";
import { IconPin } from "./icons";

export function EventCard({ event }: { event: EventSummary }) {
  const d = formatDateShort(event.debut);
  const isPast = event.statut === "finished" || new Date(event.fin) < new Date();
  return (
    <Link
      to={`/events/${event.slug}`}
      className="group animate-fade-up block overflow-hidden rounded-[16px] border border-border bg-card transition-all duration-200 hover:border-border-strong hover:-translate-y-0.5"
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-elevated">
        <img
          src={eventImage(event, 800, 600)}
          alt=""
          loading="lazy"
          className={`size-full object-cover transition-transform duration-500 group-hover:scale-[1.04] ${isPast ? "opacity-60 grayscale" : ""}`}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
        <div className="absolute left-3 top-3 flex flex-col items-center rounded-[10px] bg-background/90 px-2.5 py-1.5 backdrop-blur">
          <span className="font-display text-lg font-bold leading-none">{d.jour}</span>
          <span className="font-mono text-[10px] font-medium tracking-widest text-muted-foreground">{d.mois}</span>
        </div>
        {isPast && (
          <span className="absolute right-3 top-3 rounded-full bg-background/90 px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur">
            Terminé
          </span>
        )}
        <div className="absolute bottom-3 left-3">
          <span className="rounded-full bg-background/80 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wide text-foreground backdrop-blur">
            {event.type.nom}
          </span>
        </div>
      </div>
      <div className="p-4">
        <h3 className="font-display text-base font-semibold leading-tight text-balance line-clamp-2 group-hover:text-primary transition-colors">
          {event.nom}
        </h3>
        <div className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
          <IconPin className="size-4 shrink-0" />
          <span className="truncate">
            {event.lieu.nom} · {event.lieu.ville}
          </span>
        </div>
        <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
          <span className="text-xs text-muted-foreground">À partir de</span>
          <span className="font-display text-base font-bold">{event.prixMin ? formatEUR(event.prixMin) : "—"}</span>
        </div>
      </div>
    </Link>
  );
}

export function EventCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-[16px] border border-border bg-card" aria-hidden>
      <div className="skeleton aspect-[4/3]" />
      <div className="space-y-3 p-4">
        <div className="skeleton h-4 w-4/5 rounded" />
        <div className="skeleton h-3 w-3/5 rounded" />
        <div className="skeleton mt-3 h-8 w-full rounded" />
      </div>
    </div>
  );
}
