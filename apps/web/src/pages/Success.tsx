import { useEffect, useState } from "react";
import { useStore } from "../lib/store";
import { Button, Card, Link } from "../components/ui";
import { IconCalendar, IconCheck, IconDownload, IconTicket } from "../components/icons";
import { Footer, Page } from "../components/Layout";

interface LastOrder {
  orderNumber: string;
  eventNom: string;
  tickets: { code: string; tarif: string }[];
}

export function SuccessPage() {
  const { toast } = useStore();
  const [order, setOrder] = useState<LastOrder | null>(null);

  useEffect(() => {
    const raw = sessionStorage.getItem("billetto:last-order");
    if (raw) setOrder(JSON.parse(raw));
  }, []);

  return (
    <>
      <Page>
        <div className="mx-auto max-w-lg pt-16 text-center">
          <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-primary text-primary-foreground animate-fade-up">
            <IconCheck className="size-8" />
          </div>
          <h1 className="mt-6 font-display text-4xl font-extrabold tracking-tight">Commande confirmée</h1>
          <p className="mt-2 text-muted-foreground">
            Vos billets ont été envoyés par e-mail. Retrouvez-les à tout moment dans « Mes billets ».
          </p>
          {order && (
            <div className="mt-2 font-mono text-sm text-muted-foreground">
              Commande <span className="text-foreground">{order.orderNumber}</span>
            </div>
          )}
        </div>

        <div className="mx-auto mt-10 max-w-lg space-y-3">
          {(order?.tickets ?? [{ code: "BLT-XXXX-XXXX", tarif: "Billet" }]).map((t, i) => (
            <Card key={i} className="flex items-center gap-4 p-4">
              <span className="flex size-11 items-center justify-center rounded-[10px] bg-primary/15 text-primary">
                <IconTicket />
              </span>
              <div className="flex-1">
                <div className="font-medium">{order?.eventNom ?? "Votre événement"}</div>
                <div className="text-sm text-muted-foreground">{t.tarif}</div>
              </div>
              <span className="font-mono text-sm text-muted-foreground">{t.code}</span>
            </Card>
          ))}
        </div>

        <div className="mx-auto mt-8 flex max-w-lg flex-col gap-3 sm:flex-row">
          <Button className="flex-1" onClick={() => toast("Téléchargement des billets…", "success")}>
            <IconDownload className="size-4" /> Télécharger les billets
          </Button>
          <Button variant="outline" className="flex-1" onClick={() => toast("Ajouté au calendrier", "success")}>
            <IconCalendar className="size-4" /> Ajouter au calendrier
          </Button>
        </div>
        <div className="mx-auto mt-3 flex max-w-lg gap-3">
          <Button variant="ghost" className="flex-1" onClick={() => toast("Wallet — bientôt disponible", "info")}>
            Ajouter au Wallet
          </Button>
          <Link to="/tickets" className="flex-1">
            <Button variant="secondary" className="w-full">
              Voir mes billets
            </Button>
          </Link>
        </div>
      </Page>
      <Footer />
    </>
  );
}
