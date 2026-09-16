import { useEffect, useState } from "react";
import { fetchMyTickets } from "../lib/api";
import { formatDate, type OwnedTicket } from "../lib/data";
import { Badge, Button, Card, EmptyState, Skeleton, Tabs } from "../components/ui";
import { useRouter } from "../lib/router";
import { IconCalendar, IconPin } from "../components/icons";
import { Footer, Page } from "../components/Layout";

// Decorative QR placeholder — real code rendered from backend-issued payload.
function QrPlaceholder() {
  return (
    <div className="grid size-24 shrink-0 grid-cols-7 gap-0.5 rounded-[10px] bg-white p-2">
      {Array.from({ length: 49 }).map((_, i) => (
        <div key={i} className={`rounded-[1px] ${(i * 7 + (i % 5)) % 3 === 0 ? "bg-black" : "bg-transparent"}`} />
      ))}
    </div>
  );
}

function TicketCard({ t }: { t: OwnedTicket }) {
  const tone = t.statut === "valid" ? "success" : t.statut === "used" ? "muted" : "danger";
  const label = t.statut === "valid" ? "Valide" : t.statut === "used" ? "Utilisé" : "Remboursé";
  return (
    <Card className="animate-fade-up overflow-hidden">
      <div className="flex flex-col sm:flex-row">
        <div className="relative h-32 w-full bg-elevated sm:h-auto sm:w-40">
          <img src={t.image} alt={t.eventNom} className="size-full object-cover" />
        </div>
        <div className="flex flex-1 items-center gap-4 p-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Badge tone={tone}>{label}</Badge>
              <span className="font-mono text-xs text-muted-foreground">{t.tarif}</span>
            </div>
            <h3 className="mt-2 font-display text-lg font-semibold leading-tight">{t.eventNom}</h3>
            <div className="mt-2 space-y-1 text-sm text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <IconCalendar className="size-4" /> {formatDate(t.date)} · {t.heure}
              </div>
              <div className="flex items-center gap-1.5">
                <IconPin className="size-4" /> {t.lieu}
              </div>
            </div>
            <div className="mt-3 font-mono text-xs text-muted-foreground">{t.code}</div>
          </div>
          {t.statut === "valid" && <QrPlaceholder />}
        </div>
      </div>
    </Card>
  );
}

export function TicketsPage() {
  const { navigate } = useRouter();
  const [tickets, setTickets] = useState<OwnedTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("upcoming");

  useEffect(() => {
    fetchMyTickets().then((t) => {
      setTickets(t);
      setLoading(false);
    });
  }, []);

  const upcoming = tickets.filter((t) => t.statut === "valid");
  const past = tickets.filter((t) => t.statut !== "valid");
  const shown = tab === "upcoming" ? upcoming : past;

  return (
    <>
      <Page>
        <div className="pt-10">
          <h1 className="font-display text-4xl font-extrabold tracking-tight">Mes billets</h1>
          <p className="mt-2 text-muted-foreground">Présentez le QR code à l'entrée de l'événement.</p>
        </div>

        <div className="mt-6">
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { id: "upcoming", label: "À venir", count: upcoming.length },
              { id: "past", label: "Passés", count: past.length },
            ]}
          />
        </div>

        <div className="mt-6 space-y-4">
          {loading ? (
            Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-36 w-full rounded-[16px]" />)
          ) : shown.length === 0 ? (
            <EmptyState
              title={tab === "upcoming" ? "Aucun billet à venir" : "Aucun événement passé"}
              message="Vos futurs billets apparaîtront ici après un achat."
              action={<Button onClick={() => navigate("/events")}>Trouver un événement</Button>}
            />
          ) : (
            shown.map((t) => <TicketCard key={t.id} t={t} />)
          )}
        </div>
      </Page>
      <Footer />
    </>
  );
}
