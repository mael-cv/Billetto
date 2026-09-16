import { matchRoute, RouterProvider, useRouter } from "./lib/router";
import { StoreProvider } from "./lib/store";
import { Header, Page, Toaster } from "./components/Layout";
import { Button } from "./components/ui";
import { HomePage } from "./pages/Home";
import { EventsPage } from "./pages/Events";
import { EventDetailPage } from "./pages/EventDetail";
import { CheckoutPage } from "./pages/Checkout";
import { SuccessPage } from "./pages/Success";
import { TicketsPage } from "./pages/Tickets";
import { AuthPage } from "./pages/Auth";
import { AccountPage } from "./pages/Account";
import { OrganizerDashboardPage } from "./pages/OrganizerDashboard";
import { OrganizerEventsPage, OrganizerSalesPage } from "./pages/OrganizerEvents";
import { CreateEventPage } from "./pages/CreateEvent";
import { AdminPage } from "./pages/Admin";

function NotFound() {
  const { navigate } = useRouter();
  return (
    <Page>
      <div className="mx-auto max-w-md pt-24 text-center">
        <div className="font-display text-7xl font-extrabold text-primary">404</div>
        <h1 className="mt-4 font-display text-2xl font-bold">Page introuvable</h1>
        <p className="mt-2 text-muted-foreground">La page que vous cherchez n'existe pas ou a été déplacée.</p>
        <Button className="mt-6" onClick={() => navigate("/")}>
          Retour à l'accueil
        </Button>
      </div>
    </Page>
  );
}

// Auth pages render without the standard header/footer shell.
const FULLSCREEN = ["/login", "/register", "/forgot"];

function Routes() {
  const { path } = useRouter();
  const clean = path.split("?")[0];

  if (clean === "/login") return <AuthPage mode="login" />;
  if (clean === "/register") return <AuthPage mode="register" />;
  if (clean === "/forgot") return <AuthPage mode="forgot" />;

  if (clean === "/" || clean === "") return <HomePage />;
  if (clean === "/events") return <EventsPage />;

  const eventMatch = matchRoute(clean, "/events/:slug");
  if (eventMatch) return <EventDetailPage slug={eventMatch.slug} />;

  if (clean === "/checkout") return <CheckoutPage />;
  if (clean === "/checkout/success") return <SuccessPage />;
  if (clean === "/tickets") return <TicketsPage />;
  if (clean === "/account") return <AccountPage />;

  if (clean === "/organizer") return <OrganizerDashboardPage />;
  if (clean === "/organizer/events") return <OrganizerEventsPage />;
  if (clean === "/organizer/events/new") return <CreateEventPage />;
  if (clean === "/organizer/sales") return <OrganizerSalesPage />;
  if (clean === "/admin") return <AdminPage />;

  return <NotFound />;
}

function Shell() {
  const { path } = useRouter();
  const clean = path.split("?")[0];
  const fullscreen = FULLSCREEN.includes(clean);

  return (
    <div className="flex min-h-screen flex-col">
      {!fullscreen && <Header />}
      <div className="flex-1">
        <Routes />
      </div>
      <Toaster />
    </div>
  );
}

export default function App() {
  return (
    <RouterProvider>
      <StoreProvider>
        <Shell />
      </StoreProvider>
    </RouterProvider>
  );
}
