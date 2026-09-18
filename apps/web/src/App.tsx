import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiError } from "./lib/http";
import { RequireAuth } from "./lib/auth";
import { matchRoute, RouterProvider, useRouter } from "./lib/router";
import { StoreProvider } from "./lib/store";
import { Header, Page, Toaster } from "./components/Layout";
import { Button } from "./components/ui";
import { HomePage } from "./pages/Home";
import { EventsPage } from "./pages/Events";
import { EventDetailPage } from "./pages/EventDetail";
import { CheckoutPage } from "./pages/Checkout";
import { AwaitingTransferPage } from "./pages/AwaitingTransfer";
import { SuccessPage } from "./pages/Success";
import { TicketsPage } from "./pages/Tickets";
import { AuthPage } from "./pages/Auth";
import { AccountPage } from "./pages/Account";
import { OrganizerDashboardPage } from "./pages/OrganizerDashboard";
import { OrganizerEventsPage, OrganizerSalesPage } from "./pages/OrganizerEvents";
import { CreateEventPage } from "./pages/CreateEvent";
import { AdminPage } from "./pages/Admin";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      // Pas de nouvelle tentative sur une erreur métier (4xx) : seules les erreurs réseau / 5xx sont rejouées.
      retry: (failureCount, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && failureCount < 2,
    },
  },
});

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

  if (clean === "/checkout")
    return (
      <RequireAuth>
        <CheckoutPage />
      </RequireAuth>
    );
  if (clean === "/checkout/success")
    return (
      <RequireAuth>
        <SuccessPage />
      </RequireAuth>
    );
  if (clean === "/checkout/awaiting-transfer")
    return (
      <RequireAuth>
        <AwaitingTransferPage />
      </RequireAuth>
    );
  if (clean === "/tickets")
    return (
      <RequireAuth>
        <TicketsPage />
      </RequireAuth>
    );
  if (clean === "/account")
    return (
      <RequireAuth>
        <AccountPage />
      </RequireAuth>
    );

  const manage = ["organizer", "admin"] as const;
  if (clean === "/organizer")
    return (
      <RequireAuth roles={[...manage]}>
        <OrganizerDashboardPage />
      </RequireAuth>
    );
  if (clean === "/organizer/events")
    return (
      <RequireAuth roles={[...manage]}>
        <OrganizerEventsPage />
      </RequireAuth>
    );
  if (clean === "/organizer/events/new")
    return (
      <RequireAuth roles={[...manage]}>
        <CreateEventPage />
      </RequireAuth>
    );
  if (clean === "/organizer/sales")
    return (
      <RequireAuth roles={[...manage]}>
        <OrganizerSalesPage />
      </RequireAuth>
    );
  if (clean === "/admin")
    return (
      <RequireAuth roles={["admin"]}>
        <AdminPage />
      </RequireAuth>
    );

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
    <QueryClientProvider client={queryClient}>
      <RouterProvider>
        <StoreProvider>
          <Shell />
        </StoreProvider>
      </RouterProvider>
    </QueryClientProvider>
  );
}
