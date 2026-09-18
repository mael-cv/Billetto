import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useQueryParams } from "../lib/hooks";
import { formatDate, formatEUR, formatTime } from "../lib/format";
import { keys } from "../lib/queries";
import { useRouter } from "../lib/router";
import { Button, Card, EmptyState, ErrorState, Link, Skeleton } from "../components/ui";
import { IconCalendar, IconCheck, IconTicket } from "../components/icons";
import { Footer, Page } from "../components/Layout";

/** Fichier iCalendar de l'événement (généré localement, aucune donnée envoyée). */
function calendarHref(nom: string, debut: string, lieu: string): string {
  const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const start = new Date(debut);
  const end = new Date(start.getTime() + 3 * 3_600_000);
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Billetto//FR",
    "BEGIN:VEVENT",
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${nom.replace(/[,;\n]/g, " ")}`,
    `LOCATION:${lieu.replace(/[,;\n]/g, " ")}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`;
}

export function SuccessPage() {
  const params = useQueryParams();
  const { navigate } = useRouter();
  const id = Number(params.get("commande"));
  const order = useQuery({ queryKey: keys.order(id), queryFn: () => api.order(id), enabled: Number.isInteger(id) && id > 0 });

  if (!Number.isInteger(id) || id <= 0)
    return (
      <>
        <Page>
          <div className="pt-16">
            <EmptyState title="Aucune commande" message="Retrouvez vos achats dans « Mes billets »." action={<Button onClick={() => navigate("/tickets")}>Mes billets</Button>} />
          </div>
        </Page>
        <Footer />
      </>
    );

  const first = order.data?.billets[0];

  return (
    <>
      <Page>
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
      </Page>
      <Footer />
    </>
  );
}
