import { createContext, useContext, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Link,
  Navigate,
  NavLink,
  Outlet,
  Route,
  Routes,
  useNavigate,
  useParams,
} from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  ClipboardList,
  FilePlus2,
  LogOut,
  ShieldCheck,
  Wifi,
  WifiOff,
} from "lucide-react";
import { request, sessionSchema } from "./api";
import type { Site, StaffSession } from "./api";
import { clearAccountDrafts } from "./drafts";
import { Button, Failure, FormError, Loading, cn, useOnline } from "./ui";
import { Reception } from "./pages/reception";
import { Intake } from "./pages/intake";
import { WorkOrderDetail } from "./pages/work-order";
import { WorkshopPicture } from "./workshop-picture";

const StaffContext = createContext<{
  session: StaffSession;
  site: Site;
} | null>(null);
export function useStaff() {
  const value = useContext(StaffContext);
  if (!value) throw new Error("Staff workspace is unavailable.");
  return value;
}

export function App() {
  const client = useQueryClient();
  const session = useQuery({
    queryKey: ["session"],
    queryFn: () => request("/session", sessionSchema),
  });
  useEffect(() => {
    const expired = () => {
      const current = client.getQueryData(["session"]);
      const parsed = sessionSchema.safeParse(current);
      if (parsed.success && parsed.data.authenticated) {
        try {
          clearAccountDrafts(parsed.data.user.id);
        } catch {
          /* The browser may deny storage access. */
        }
      }
      client.removeQueries({
        predicate: (query) => query.queryKey[0] !== "session",
      });
      client.setQueryData(["session"], { authenticated: false });
    };
    window.addEventListener("vmms-session-expired", expired);
    return () => window.removeEventListener("vmms-session-expired", expired);
  }, [client]);
  if (session.isPending)
    return (
      <div className="mx-auto max-w-3xl p-8">
        <Loading label="Connecting to Raymond Gray" />
      </div>
    );
  if (session.isError)
    return (
      <div className="mx-auto max-w-xl p-6 pt-20">
        <Brand />
        <h1 className="mb-6 mt-10 text-2xl font-semibold">
          The workspace is unavailable
        </h1>
        <Failure
          error={session.error}
          retry={() => {
            void session.refetch();
          }}
        />
      </div>
    );
  if (!session.data.authenticated) return <SignIn />;
  const staff = session.data;
  const firstSite = staff.sites[0];
  if (!firstSite)
    return (
      <div className="mx-auto max-w-xl p-8 pt-20">
        <Brand />
        <h1 className="mt-10 text-2xl font-semibold">
          Site access is required
        </h1>
        <p className="mt-3 text-zinc-500">
          Your account has no active service-centre membership. Ask your site
          administrator to assign access.
        </p>
        <SignOut session={staff} />
      </div>
    );
  return (
    <Routes>
      <Route path="/sites/:siteId" element={<Workspace session={staff} />}>
        <Route index element={<Navigate to="work-orders" replace />} />
        <Route path="work-orders" element={<Reception />} />
        <Route path="intake" element={<Intake />} />
        <Route path="work-orders/:orderId" element={<WorkOrderDetail />} />
      </Route>
      <Route
        path="*"
        element={<Navigate to={`/sites/${firstSite.id}/work-orders`} replace />}
      />
    </Routes>
  );
}

function Brand({ dark = false }: { dark?: boolean }) {
  return (
    <div>
      <img
        src={
          dark
            ? "/brand/raymond-gray-logo-white.png"
            : "/brand/raymond-gray-logo.png"
        }
        alt="Raymond Gray"
        width={1224}
        height={357}
        className="h-auto w-44 max-w-full"
      />
      <p
        className={cn("mt-2 text-xs", dark ? "text-zinc-200" : "text-zinc-500")}
      >
        Vehicle maintenance management
      </p>
    </div>
  );
}

function SignIn() {
  const online = useOnline();
  const signInResult = new URLSearchParams(window.location.search).get("signin");
  return (
    <div className="sign-in-layout grid min-h-dvh lg:grid-cols-2">
      <div className="sign-in-visual relative isolate flex min-w-0 flex-col overflow-hidden bg-zinc-950 p-6 text-white sm:p-10 lg:p-16">
        <WorkshopPicture />
        <div className="absolute inset-0 -z-10 bg-zinc-950/20" aria-hidden="true" />
        <Brand dark />
        <div className="max-w-lg py-10 lg:pb-10 lg:pt-20">
          <div className="mb-5 inline-flex items-center gap-2 text-sm text-emerald-200">
            <span className="size-1.5 rounded-full bg-emerald-400" />
            Raymond Gray VMMS
          </div>
          <h1 className="text-balance text-3xl font-semibold leading-tight sm:text-4xl lg:text-5xl">
            Service centre portal
          </h1>
          <p className="mt-5 hidden max-w-sm text-pretty text-sm leading-6 text-zinc-200 sm:block lg:text-base lg:leading-7">
            Customer concerns, maintenance records and the evidence for each
            service decision, together in one place.
          </p>
        </div>
        <div className="mt-auto hidden w-fit items-center gap-2 rounded-md bg-zinc-950/70 px-3 py-2 text-xs text-zinc-100 lg:flex">
          <ShieldCheck className="size-4" aria-hidden="true" />
          Individual account access
        </div>
      </div>
      <main className="flex items-center justify-center px-6 py-12 sm:px-12">
        <div className="w-full max-w-sm">
          <p className="text-sm text-zinc-500">Welcome to your workspace</p>
          <h2 className="mt-2 text-3xl font-semibold text-zinc-950">
            Sign in to VMMS
          </h2>
          <p className="mb-8 mt-3 text-pretty text-sm leading-6 text-zinc-500">
            Use your own approved account, including on a shared computer. Choose an available sign-in method on the secure identity page.
          </p>
          {signInResult === "not-approved" && (
            <p role="status" className="mb-5 rounded-md border-l-2 border-amber-500 bg-amber-50 px-3 py-2 text-sm text-amber-950">
              Your identity is not approved for VMMS yet. Contact your service-centre administrator.
            </p>
          )}
          {signInResult === "failed" && (
            <p role="status" className="mb-5 rounded-md border-l-2 border-rose-500 bg-rose-50 px-3 py-2 text-sm text-rose-950">
              Sign-in could not be completed. Please try again.
            </p>
          )}
          {!online && (
            <p role="status" className="mb-4 text-sm text-amber-800">
              You are offline. Reconnect to sign in.
            </p>
          )}
          <Button
            type="button"
            disabled={!online}
            className="w-full"
            onClick={() => window.location.assign("/api/v1/auth/oidc/start")}
          >
            Continue to secure sign-in
            <ArrowRight className="size-4" aria-hidden="true" />
          </Button>
          <p className="mt-8 text-xs leading-5 text-zinc-500">
            Need access? Contact your service-centre administrator.
          </p>
        </div>
      </main>
    </div>
  );
}

function SignOut({
  session,
  compact = false,
}: {
  session: StaffSession;
  compact?: boolean;
}) {
  const client = useQueryClient();
  const logout = useMutation({
    mutationFn: () => request("/session", sessionSchema, { method: "DELETE" }),
    onSuccess: async (result) => {
      await client.cancelQueries();
      try {
        clearAccountDrafts(session.user.id);
      } catch {
        /* Session expiry also removes access to the draft. */
      }
      client.setQueryData(["session"], result);
      client.removeQueries({
        predicate: (query) => query.queryKey[0] !== "session",
      });
    },
  });
  return (
    <div>
      <button
        className={cn(
          "flex min-h-11 items-center gap-2 text-sm",
          compact ? "text-zinc-400 hover:text-white" : "mt-6 text-zinc-600",
        )}
        onClick={() => logout.mutate()}
        disabled={logout.isPending}
      >
        <LogOut className="size-4" aria-hidden="true" />
        {logout.isPending ? "Signing out…" : "Sign out"}
      </button>
      <FormError error={logout.error} />
    </div>
  );
}

function Workspace({ session }: { session: StaffSession }) {
  const { siteId } = useParams();
  const site = session.sites.find((item) => item.id === siteId);
  const navigate = useNavigate();
  const client = useQueryClient();
  const online = useOnline();
  const [switchError, setSwitchError] = useState<string | null>(null);
  if (!site) return <Navigate to="/" replace />;
  function changeSite(nextSite: string) {
    try {
      clearAccountDrafts(session.user.id);
    } catch {
      setSwitchError(
        "Tab storage could not be cleared. Close this tab before switching site.",
      );
      return;
    }
    client.removeQueries({
      predicate: (query) => query.queryKey[0] !== "session",
    });
    navigate(`/sites/${nextSite}/work-orders`);
  }
  return (
    <StaffContext.Provider value={{ session, site }}>
      <a className="skip-link" href="#workspace-main">
        Skip to content
      </a>
      <div className="min-h-dvh lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
        <aside className="flex flex-col bg-zinc-950 p-5 text-zinc-300 lg:min-h-dvh lg:p-6">
          <Link
            to={`/sites/${site.id}/work-orders`}
            aria-label="Raymond Gray reception"
          >
            <Brand dark />
          </Link>
          <div className="mt-7 border-t border-zinc-800 pt-5">
            <p className="text-xs font-medium text-zinc-500">WORKSPACE</p>
            <p className="mt-2 text-sm font-medium text-white">{site.name}</p>
            <p className="mt-1 text-xs text-zinc-500">{site.code}</p>
          </div>
          <nav
            aria-label="Primary navigation"
            className="mt-5 flex gap-2 lg:flex-col"
          >
            <NavLink
              end
              to={`/sites/${site.id}/work-orders`}
              className={({ isActive }) =>
                cn("nav-link", isActive && "nav-link-active")
              }
            >
              <ClipboardList className="size-4" aria-hidden="true" />
              Work orders
            </NavLink>
            {site.canWrite && (
              <NavLink
                to={`/sites/${site.id}/intake`}
                className={({ isActive }) =>
                  cn("nav-link", isActive && "nav-link-active")
                }
              >
                <FilePlus2 className="size-4" aria-hidden="true" />
                New intake
              </NavLink>
            )}
          </nav>
          <div className="mt-auto hidden border-t border-zinc-800 pt-5 lg:block">
            <p className="text-sm font-medium text-zinc-200">
              {session.user.displayName}
            </p>
            <p className="mt-1 text-xs text-zinc-500">Personal staff account</p>
            <SignOut session={session} compact />
          </div>
        </aside>
        <div className="min-w-0">
          <header className="flex min-h-20 flex-wrap items-center justify-between gap-3 border-b border-zinc-200 bg-white px-5 py-3 sm:px-8">
            <div className="text-sm text-zinc-500">
              Operations <span className="mx-2 text-zinc-300">/</span>{" "}
              <span className="font-medium text-zinc-800">Reception</span>
            </div>
            <div className="flex items-center gap-5">
              {session.sites.length > 1 && (
                <div>
                  <label className="sr-only" htmlFor="site-select">
                    Service centre
                  </label>
                  <select
                    id="site-select"
                    value={site.id}
                    onChange={(event) => changeSite(event.target.value)}
                    className="max-w-48"
                  >
                    <option disabled value="">
                      Select site
                    </option>
                    {session.sites.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div
                className={cn(
                  "flex items-center gap-2 text-xs",
                  online ? "text-zinc-500" : "text-amber-800",
                )}
              >
                {online ? (
                  <Wifi className="size-3.5" aria-hidden="true" />
                ) : (
                  <WifiOff className="size-3.5" aria-hidden="true" />
                )}
                {online ? "Connected" : "Offline"}
              </div>
              <div className="hidden border-l border-zinc-200 pl-5 text-sm font-medium text-zinc-700 sm:block">
                {session.user.displayName}
              </div>
              <div className="lg:hidden">
                <SignOut session={session} />
              </div>
            </div>
          </header>
          {!online && (
            <div
              role="status"
              className="border-b border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-900 sm:px-8"
            >
              Connection lost. You can keep an intake draft in this tab. Server
              changes need a connection.
            </div>
          )}
          {switchError && (
            <div role="alert" className="p-4 text-sm text-red-800">
              {switchError}
            </div>
          )}
          <main
            id="workspace-main"
            className="mx-auto w-full max-w-7xl px-5 py-7 sm:px-8 sm:py-9"
            tabIndex={-1}
          >
            <Outlet key={site.id} />
          </main>
          <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200 px-5 py-5 text-xs text-zinc-500 sm:px-8">
            <span>Raymond Gray VMMS</span>
            <span>Times shown in Africa/Accra · UTC+0</span>
          </footer>
        </div>
      </div>
    </StaffContext.Provider>
  );
}

export function BackToQueue() {
  const { site } = useStaff();
  return (
    <Link
      className="mb-5 inline-flex min-h-11 items-center gap-2 text-sm text-zinc-500 hover:text-zinc-900"
      to={`/sites/${site.id}/work-orders`}
    >
      <ArrowLeft className="size-4" aria-hidden="true" />
      Work orders
    </Link>
  );
}
