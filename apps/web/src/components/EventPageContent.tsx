import { useEventPage } from "../lib/queries";
import { formatTime } from "../lib/format";
import type { EventDetail, Scope } from "../lib/types";
import { Skeleton } from "./ui";

/**
 * Contenu éditorial d'un événement, lu dans MongoDB (collection event_pages) et
 * croisé par l'API avec l'événement PostgreSQL : programme, médias, sections, FAQ.
 * Sans page rédigée, l'API renvoie le contenu du template par défaut.
 */
export function EventPageContent({ event, scope }: { event: EventDetail; scope: Scope }) {
  const query = useEventPage(event.slug, scope);
  if (query.isLoading) {
    return (
      <div className="mt-10 space-y-3">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  if (!query.data) return null;
  const { page, template, personnalisee } = query.data;
  const tz = event.fuseauHoraire;

  return (
    <div data-testid="event-page" data-personnalisee={personnalisee}>
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <span className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1 font-mono text-xs font-semibold text-primary">
          ✦ {template.name}
        </span>
        {template.highlights.map((h, idx) => (
          <span key={idx} className="rounded-full border border-border bg-card/60 px-3 py-1 text-xs text-foreground/80">
            ✓ {h}
          </span>
        ))}
        {page.tags.map((t) => (
          <span key={t} className="rounded-full bg-elevated px-3 py-1 font-mono text-xs text-muted-foreground">
            #{t}
          </span>
        ))}
      </div>

      {page.medias.length > 0 && (
        <section className="mt-10">
          <h2 className="font-display text-xl font-bold">Galerie</h2>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {page.medias.map((m, i) => (
              <figure key={i} className="overflow-hidden rounded-[12px] border border-border bg-card">
                {m.type === "image" ? (
                  <img src={m.url} alt={m.legende ?? ""} loading="lazy" className="aspect-video w-full object-cover" />
                ) : (
                  <a href={m.url} target="_blank" rel="noreferrer" className="flex aspect-video items-center justify-center text-sm text-primary">
                    ▶ {m.type === "video" ? "Vidéo" : "Audio"}
                  </a>
                )}
                {m.legende && <figcaption className="px-3 py-2 text-xs text-muted-foreground">{m.legende}</figcaption>}
              </figure>
            ))}
          </div>
        </section>
      )}

      {page.programme.length > 0 && (
        <section className="mt-10" data-testid="programme">
          <h2 className="font-display text-xl font-bold">Programme</h2>
          <ol className="mt-4 space-y-2 border-l-2 border-primary/30 pl-4">
            {page.programme.map((p, i) => (
              <li key={i} className="relative rounded-[12px] border border-border bg-card p-3.5">
                <span className="absolute -left-[23px] top-5 size-3 rounded-full bg-primary" />
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-mono text-sm text-primary">{formatTime(p.heure, tz)}</span>
                  {p.scene && <span className="text-xs text-muted-foreground">{p.scene}</span>}
                </div>
                <div className="mt-1 font-medium">{p.titre}</div>
                {(p.artiste || p.dureeMin) && (
                  <div className="text-sm text-muted-foreground">
                    {p.artiste}
                    {p.artiste && p.dureeMin ? " · " : ""}
                    {p.dureeMin ? `${p.dureeMin} min` : ""}
                  </div>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}

      {page.sections.length > 0 && (
        <div className="mt-10 space-y-6">
          {page.sections.map((sec, i) => (
            <section key={i} className="rounded-[16px] border border-border bg-card p-5">
              <h3 className="flex items-center gap-2 font-display text-lg font-bold text-foreground">
                <span className="flex size-7 items-center justify-center rounded-lg bg-primary/15 text-xs text-primary">◈</span>
                {sec.title}
              </h3>
              <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">{sec.content}</p>
            </section>
          ))}
        </div>
      )}

      {page.faq.length > 0 && (
        <section className="mt-10">
          <h2 className="flex items-center gap-2 font-display text-xl font-bold">
            <span>Questions fréquentes</span>
            <span className="font-mono text-xs font-normal text-muted-foreground">document MongoDB</span>
          </h2>
          <div className="mt-4 space-y-3">
            {page.faq.map((item, idx) => (
              <div key={idx} className="rounded-[12px] border border-border bg-card/50 p-4">
                <h4 className="text-sm font-semibold text-foreground">{item.question}</h4>
                <p className="mt-1.5 text-sm text-muted-foreground">{item.answer}</p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
