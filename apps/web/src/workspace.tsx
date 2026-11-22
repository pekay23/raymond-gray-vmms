import { createContext, lazy, Suspense, useContext, useEffect, useLayoutEffect, useState } from "react";
import type { ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Link,
  Navigate,
  NavLink,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Activity,
  BookOpen,
  CarFront,
  ClipboardCheck,
  ClipboardList,
  Gauge,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  X,
  MessageSquareText,
  Settings2,
  UsersRound,
  UserRoundPlus,
  ShieldCheck,
  Wifi,
  WifiOff,
} from "lucide-react";
import { ownerOidcStartResponseSchema, ownerSessionSchema, ownerVehicleListSchema, request, rpLogoutResponseSchema, sessionSchema } from "./api";
import type { Site, StaffSession } from "./api";
import { clearAccountDrafts, clearAllWorkspaceDrafts } from "./drafts";
import { Button, Failure, FormError, Loading, cn, useOnline } from "./ui";
import { WorkshopPicture } from "./workshop-picture";
import brandImages from "./generated/brand-images.json";
import { workspaceCapabilities, workspaceHomePath } from "./workspace-navigation";

const Reception = lazy(() => import("./pages/reception").then(({ Reception: page }) => ({ default: page })));
const ServiceRequests = lazy(() => import("./pages/service-requests").then(({ ServiceRequests: page }) => ({ default: page })));
const ServiceHistory = lazy(() => import("./pages/service-history").then(({ ServiceHistory: page }) => ({ default: page })));
const Intake = lazy(() => import("./pages/intake").then(({ Intake: page }) => ({ default: page })));
const MyAssignedTasks = lazy(() => import("./pages/my-assigned-tasks").then(({ MyAssignedTasks: page }) => ({ default: page })));
const WorkOrderDetail = lazy(() => import("./pages/work-order").then(({ WorkOrderDetail: page }) => ({ default: page })));
const PrintWorkOrder = lazy(() => import("./pages/print-work-order").then(({ PrintWorkOrder: page }) => ({ default: page })));
const PrintTaskProgressReport = lazy(() => import("./pages/print-task-progress-report").then(({ PrintTaskProgressReport: page }) => ({ default: page })));
const PrintMaintenanceChecklistReport = lazy(() => import("./pages/print-maintenance-checklist-report").then(({ PrintMaintenanceChecklistReport: page }) => ({ default: page })));
const Workforce = lazy(() => import("./pages/workforce").then(({ Workforce: page }) => ({ default: page })));
const HeadOverview = lazy(() => import("./pages/head-overview").then(({ HeadOverview: page }) => ({ default: page })));
const HeadActivity = lazy(() => import("./pages/head-activity").then(({ HeadActivity: page }) => ({ default: page })));
const PrintHeadOverview = lazy(() => import("./pages/print-head-overview").then(({ PrintHeadOverview: page }) => ({ default: page })));
const Messages = lazy(() => import("./pages/messages").then(({ Messages: page }) => ({ default: page })));
const StaffAccounts = lazy(() => import("./pages/staff-accounts").then(({ StaffAccounts: page }) => ({ default: page })));
const Documents = lazy(() => import("./pages/documents").then(({ Documents: page }) => ({ default: page })));
const VehicleLearning = lazy(() => import("./pages/vehicle-learning").then(({ VehicleLearning: page }) => ({ default: page })));
const FinanceSetup = lazy(() => import("./pages/finance-setup").then(({ FinanceSetup: page }) => ({ default: page })));
const SalesDeliveries = lazy(() => import("./pages/sales-deliveries").then(({ SalesDeliveries: page }) => ({ default: page })));
const Today = lazy(() => import("./pages/today").then(({ Today: page }) => ({ default: page })));

const StaffContext = createContext<{
  session: StaffSession;
  site: Site;
} | null>(null);
const signOutChannelName = "vmms-browser-session";
const signOutStorageKey = "vmms:browser-session-ended";
const signOutTabId = crypto.randomUUID();

function notifyOtherTabsOfSignOut() {
  try {
    const channel = new BroadcastChannel(signOutChannelName);
    channel.postMessage({ type: "signed-out", sourceTabId: signOutTabId });
    channel.close();
  } catch {
    /* The storage event below is the fallback for browsers without BroadcastChannel. */
  }
  try {
    window.localStorage.setItem(signOutStorageKey, `${Date.now()}-${Math.random()}`);
  } catch {
    /* The current tab still signs out when cross-tab storage is unavailable. */
  }
}

export function useStaff() {
  const value = useContext(StaffContext);
  if (!value) throw new Error("Staff workspace is unavailable.");
  return value;
}

export function App() {
  const client = useQueryClient();
  const location = useLocation();
  const signedOutRoute = location.pathname === "/signed-out";
  useEffect(() => {
    const updateViewportLayout = () => {
      const width = Math.min(window.innerWidth, window.visualViewport?.width ?? window.innerWidth);
      document.documentElement.dataset.vmmsCompactViewport = width <= 640 ? "true" : "false";
      document.documentElement.dataset.vmmsZoomCompactViewport = width <= 640
        && window.matchMedia("(pointer: fine)").matches
        && (window.devicePixelRatio >= 2
          || (window.visualViewport !== null && window.visualViewport.width < window.innerWidth * 0.75))
        ? "true"
        : "false";
      document.documentElement.style.setProperty("--vmms-visual-viewport-width", `${Math.max(1, Math.ceil(width))}px`);
    };
    updateViewportLayout();
    window.addEventListener("resize", updateViewportLayout);
    window.visualViewport?.addEventListener("resize", updateViewportLayout);
    return () => {
      window.removeEventListener("resize", updateViewportLayout);
      window.visualViewport?.removeEventListener("resize", updateViewportLayout);
      delete document.documentElement.dataset.vmmsCompactViewport;
      delete document.documentElement.dataset.vmmsZoomCompactViewport;
      document.documentElement.style.removeProperty("--vmms-visual-viewport-width");
    };
  }, []);
  const requestedAudience = new URLSearchParams(window.location.search).get("audience");
  const session = useQuery({
    queryKey: ["session"],
    queryFn: () => request("/session", sessionSchema),
    enabled: !signedOutRoute,
  });
  const ownerSession = useQuery({
    queryKey: ["owner-session"],
    queryFn: () => request("/owner/session", ownerSessionSchema),
    enabled: !signedOutRoute,
  });
  useEffect(() => {
    const clearOtherTab = () => {
      try { clearAllWorkspaceDrafts(); } catch { /* Storage may be unavailable in this tab. */ }
      client.clear();
      window.location.replace("/");
    };
    let channel: BroadcastChannel | undefined;
    try {
      channel = new BroadcastChannel(signOutChannelName);
      channel.addEventListener("message", (event: MessageEvent<unknown>) => {
        if (typeof event.data === "object" && event.data !== null && "type" in event.data && event.data.type === "signed-out"
          && "sourceTabId" in event.data && event.data.sourceTabId !== signOutTabId) clearOtherTab();
      });
    } catch {
      /* Use the storage event fallback below. */
    }
    const storageEnded = (event: StorageEvent) => {
      if (event.key === signOutStorageKey && event.newValue) clearOtherTab();
    };
    window.addEventListener("storage", storageEnded);
    return () => {
      channel?.close();
      window.removeEventListener("storage", storageEnded);
    };
  }, [client]);
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
  useEffect(() => {
    const expired = () => {
      client.removeQueries({ queryKey: ["owner-vehicles"] });
      client.setQueryData(["owner-session"], { authenticated: false });
    };
    window.addEventListener("vmms-owner-session-expired", expired);
    return () => window.removeEventListener("vmms-owner-session-expired", expired);
  }, [client]);
  if (signedOutRoute) return <SignedOutPage />;
  if (session.isPending || ownerSession.isPending)
    return (
      <div className="mx-auto max-w-3xl p-8">
        <Loading label="Connecting to Raymond Gray" />
      </div>
    );
  if (session.isError || ownerSession.isError)
    return (
      <div className="mx-auto max-w-xl p-6 pt-20">
        <Brand />
        <h1 className="mb-6 mt-10 text-2xl font-semibold">
          Your access could not be confirmed
        </h1>
        <Failure
          error={session.isError ? session.error : ownerSession.error}
          retry={() => {
            void session.refetch();
            void ownerSession.refetch();
          }}
        />
      </div>
    );
  if (requestedAudience === "owner") {
    return ownerSession.data.authenticated ? <OwnerPortal /> : <SignIn initialAudience="owner" />;
  }
  if (requestedAudience === "staff") {
    return session.data.authenticated ? <StaffWorkspace staff={session.data} /> : <SignIn initialAudience="staff" />;
  }
  if (session.data.authenticated && ownerSession.data.authenticated)
    return <ChooseWorkspace />;
  if (!session.data.authenticated)
    return ownerSession.data.authenticated ? <OwnerPortal /> : <SignIn initialAudience="staff" />;
  const staff = session.data;
  return <StaffWorkspace staff={staff} />;
}

function SignedOutPage() {
  const params = new URLSearchParams(window.location.search);
  const centralUnavailable = params.get("central") === "unavailable";
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col justify-center px-6 py-12">
      <Brand />
      <section className="mt-12 border-l-2 border-blue-700 pl-5" aria-labelledby="signed-out-title">
        <p className="text-sm text-zinc-500">Raymond Gray VMMS</p>
        <h1 id="signed-out-title" className="mt-2 text-3xl font-semibold text-zinc-950">You’re signed out</h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-zinc-600">Your VMMS sessions on this browser have been cleared.</p>
        {centralUnavailable ? (
          <p role="status" className="mt-4 max-w-xl rounded-md border border-amber-300 border-l-4 border-l-amber-600 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950">
            We could not confirm sign-out from the shared account service. VMMS access on this browser is still cleared.
          </p>
        ) : null}
        <nav className="mt-8 flex flex-wrap gap-x-6 gap-y-3 text-sm font-medium" aria-label="Sign in options">
          <Link className="underline underline-offset-4" to="/?audience=staff">Sign in to the staff workspace</Link>
          <Link className="underline underline-offset-4" to="/?audience=owner">Sign in as a vehicle owner</Link>
        </nav>
      </section>
    </main>
  );
}

function StaffWorkspace({ staff }: { staff: StaffSession }) {
  const firstSite = staff.sites[0];
  if (!firstSite || firstSite.roleCodes.length === 0)
    return (
      <div className="mx-auto max-w-xl p-8 pt-20">
        <Brand />
        <h1 className="mt-10 text-2xl font-semibold">
          {firstSite ? "No work role is assigned" : "You do not have service-centre access yet"}
        </h1>
        {firstSite && <p className="mt-2 text-sm text-zinc-500">{firstSite.name} · {firstSite.code}</p>}
        <p className="mt-3 text-zinc-500">
          {firstSite
            ? "You are signed in, but a service-centre administrator must assign your work role before you can use the workspace."
            : "Ask your service-centre administrator to give your account access."}
        </p>
        <SignOut />
      </div>
    );
  return (
    <Routes>
      <Route path="/sites/:siteId" element={<Workspace session={staff} />}>
        <Route index element={<WorkspaceHomeRedirect />} />
        <Route path="today" element={<WorkspaceAccess allow="canOpenToday"><Today /></WorkspaceAccess>} />
        <Route path="overview" element={<WorkspaceAccess allow="canOpenHeadOverview"><HeadOverview /></WorkspaceAccess>} />
        <Route path="activity" element={<WorkspaceAccess allow="canOpenHeadOverview"><HeadActivity /></WorkspaceAccess>} />
        <Route path="overview/print" element={<WorkspaceAccess allow="canOpenHeadOverview"><PrintHeadOverview /></WorkspaceAccess>} />
        <Route path="work-orders" element={<WorkspaceAccess allow="canOpenWorkOrders"><Reception /></WorkspaceAccess>} />
        <Route path="requests" element={<WorkspaceAccess allow="canOpenRequests"><ServiceRequests /></WorkspaceAccess>} />
        <Route path="service-history" element={<WorkspaceAccess allow="canOpenServiceHistory"><ServiceHistory /></WorkspaceAccess>} />
        <Route path="my-tasks" element={<WorkspaceAccess allow="canOpenMyTasks"><MyAssignedTasks /></WorkspaceAccess>} />
        <Route path="intake" element={<WorkspaceAccess allow="canRegisterVisit"><Intake /></WorkspaceAccess>} />
        <Route path="requests/:requestId/reception" element={<WorkspaceAccess allow="canRegisterVisit"><Intake /></WorkspaceAccess>} />
        <Route path="staff" element={<WorkspaceAccess allow="canManageTeam"><Workforce /></WorkspaceAccess>} />
        <Route path="staff/accounts" element={<WorkspaceAccess allow="canManageStaffAccounts"><StaffAccounts /></WorkspaceAccess>} />
        <Route path="messages" element={<WorkspaceAccess allow="canSendStaffMessages"><Messages /></WorkspaceAccess>} />
        <Route path="documents" element={<WorkspaceAccess allow="canOpenDocuments"><Documents /></WorkspaceAccess>} />
        <Route path="vehicle-learning" element={<WorkspaceAccess allow="canOpenVehicleLearning"><VehicleLearning /></WorkspaceAccess>} />
        <Route path="finance-setup" element={<WorkspaceAccess allow="canOpenFinanceSetup"><FinanceSetup /></WorkspaceAccess>} />
        <Route path="sales-deliveries" element={<WorkspaceAccess allow="canOpenSalesDeliveries"><SalesDeliveries /></WorkspaceAccess>} />
        <Route path="work-orders/:orderId/print" element={<WorkspaceAccess allow="canOpenWorkOrders"><PrintWorkOrder /></WorkspaceAccess>} />
        <Route path="work-orders/:orderId/progress-report" element={<WorkspaceAccess allow="canOpenWorkOrders"><PrintTaskProgressReport /></WorkspaceAccess>} />
        <Route path="work-orders/:orderId/checklists/:checklistId/report" element={<WorkspaceAccess allow="canOpenWorkOrders"><PrintMaintenanceChecklistReport /></WorkspaceAccess>} />
        <Route path="work-orders/:orderId" element={<WorkspaceAccess allow="canOpenWorkOrders"><WorkOrderDetail /></WorkspaceAccess>} />
      </Route>
      <Route
        path="*"
        element={<Navigate to={workspaceHomePath(firstSite)} replace />}
      />
    </Routes>
  );
}

function WorkspaceHomeRedirect() {
  const { siteId } = useParams();
  const { session } = useStaff();
  const site = session.sites.find((item) => item.id === siteId);
  return <Navigate to={site ? workspaceHomePath(site) : "/"} replace />;
}

function WorkspaceAccess({ allow, children }: { allow: keyof ReturnType<typeof workspaceCapabilities>; children: ReactNode }) {
  const { site } = useStaff();
  const capabilities = workspaceCapabilities(site);
  return capabilities[allow] ? children : <Navigate to={workspaceHomePath(site)} replace />;
}

function workspacePageLabel(pathname: string, siteId: string): string {
  const path = pathname.replace(`/sites/${siteId}/`, "");
  if (path === "today") return "Today";
  if (path.startsWith("requests/") && path.endsWith("/reception")) return "Record vehicle visit";
  if (path === "requests" || path.startsWith("requests/")) return "Requests and callbacks";
  if (path === "work-orders") return "Work orders";
  if (path.startsWith("work-orders/")) return "Work order details";
  if (path === "sales-deliveries") return "Sales and PDI history";
  if (path === "my-tasks") return "My assigned tasks";
  if (path === "overview" || path === "overview/print") return "Service-centre overview";
  if (path === "staff") return "People and roles";
  if (path === "staff/accounts") return "Staff accounts";
  if (path === "messages") return "Staff messages";
  if (path === "documents") return "Documents";
  if (path === "vehicle-learning") return "Vehicle learning";
  if (path === "intake") return "New intake";
  return "Workspace";
}

function ChooseWorkspace() {
  const client = useQueryClient();
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  async function signOutAndSwitch() {
    setSigningOut(true);
    setSignOutError(null);
    try {
      const result = await request("/auth/oidc/logout", rpLogoutResponseSchema, { method: "POST", body: { destination: "signed-out" } });
      await client.cancelQueries();
      client.clear();
      try { clearAllWorkspaceDrafts(); } catch { /* Server sessions are already revoked. */ }
      notifyOtherTabsOfSignOut();
      window.location.replace(result.logoutUrl ?? "/signed-out?central=unavailable");
    } catch {
      setSignOutError("We could not confirm sign-out. Check your connection and try again before leaving this shared device.");
      setSigningOut(false);
    }
  }
  return (
    <div className="sign-in-layout grid w-full min-w-0 grid-cols-[minmax(0,1fr)] min-h-dvh lg:grid-cols-2">
      <div className="sign-in-visual relative isolate flex min-w-0 flex-col overflow-hidden bg-zinc-950 p-6 text-white sm:p-10 lg:p-16">
        <WorkshopPicture />
        <div className="absolute inset-0 -z-10 bg-zinc-950/20" aria-hidden="true" />
        <Brand dark compact />
        <div className="w-full min-w-0 max-w-lg py-10 [overflow-wrap:anywhere] lg:pb-10 lg:pt-20">
          <div className="mb-5 flex w-fit max-w-full flex-wrap items-center gap-2 text-sm text-emerald-200 [overflow-wrap:anywhere]">
            <span className="size-1.5 rounded-full bg-emerald-400" />
            Raymond Gray VMMS
          </div>
          <h1 className="max-w-full text-balance text-3xl font-semibold leading-tight [overflow-wrap:anywhere] sm:text-4xl lg:text-5xl">
            Vehicle service portal
          </h1>
          <p className="mt-5 hidden max-w-sm text-pretty text-sm leading-6 text-zinc-200 sm:block lg:text-base lg:leading-7">
            Choose the workspace for the work you are here to do.
          </p>
        </div>
      </div>
      <main className="flex items-center justify-center px-6 py-12 sm:px-12">
        <div className="w-full max-w-sm">
          <p className="text-sm text-zinc-500">Raymond Gray portal</p>
          <h2 className="mt-2 text-3xl font-semibold text-zinc-950">Choose your workspace</h2>
          <p className="mb-8 mt-3 text-pretty text-sm leading-6 text-zinc-500">
            Your team and vehicle-owner access are kept separate, even when they use the same identity.
          </p>
          <div className="grid gap-3">
            <Button type="button" className="w-full" onClick={() => window.location.assign("/?audience=staff")}>
              Team member workspace
              <ArrowRight className="size-4" aria-hidden="true" />
            </Button>
            <Button type="button" variant="secondary" className="w-full" onClick={() => window.location.assign("/?audience=owner")}>
              Vehicle owner access
              <ArrowRight className="size-4" aria-hidden="true" />
            </Button>
          </div>
          <button type="button" className="mt-6 min-h-11 text-sm text-zinc-600 underline underline-offset-4 hover:text-zinc-950" onClick={signOutAndSwitch} disabled={signingOut}>
            {signingOut ? "Signing out…" : "Sign out of this browser"}
          </button>
          {signOutError && <p role="alert" className="mt-2 text-sm text-red-700">{signOutError}</p>}
        </div>
      </main>
    </div>
  );
}

function Brand({ dark = false, compact = false }: { dark?: boolean; compact?: boolean }) {
  const brandImage = dark ? brandImages.variants.white : brandImages.variants.standard;
  return (
    <div>
      <picture>
        <source
          type="image/webp"
          srcSet={brandImage.webp.map((image) => `${image.src} ${image.width}w`).join(", ")}
          sizes={compact ? "64px" : "176px"}
        />
        <img
          src={brandImage.fallback}
          alt="Raymond Gray"
          width={brandImage.width}
          height={brandImage.height}
          sizes={compact ? "64px" : "176px"}
          className={cn("h-auto max-w-full", compact ? "w-16" : "w-44")}
        />
      </picture>
      <p
        className={cn("brand-caption mt-2 text-xs", dark ? "text-zinc-200" : "text-zinc-500", compact && "hidden")}
      >
        Vehicle maintenance management
      </p>
    </div>
  );
}

type SignInAudience = "staff" | "owner";
const signInAudiences: SignInAudience[] = ["staff", "owner"];

function SignIn({ initialAudience }: { initialAudience: SignInAudience }) {
  const online = useOnline();
  const signInResult = new URLSearchParams(window.location.search).get("signin");
  const [audience, setAudience] = useState<SignInAudience>(initialAudience);
  const [claimToken, setClaimToken] = useState<string | undefined>();
  const [invitationError, setInvitationError] = useState<string | null>(null);
  const ownerStart = useMutation({
    mutationFn: () => request("/owner/auth/oidc/start", ownerOidcStartResponseSchema, {
      method: "POST",
      body: claimToken === undefined ? {} : { claimToken },
    }),
    onSuccess: (result) => window.location.assign(result.authorizationUrl),
  });
  useLayoutEffect(() => {
    const readInvitationFragment = () => {
      const fragment = new URLSearchParams(window.location.hash.slice(1));
      const token = fragment.get("owner-invitation");
      if (token === null) return;
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}`);
      setAudience("owner");
      if (/^[A-Za-z0-9_-]{43,128}$/.test(token)) setClaimToken(token);
      else setInvitationError("This invitation link could not be read. Open the original link again or contact the service centre.");
    };
    readInvitationFragment();
    window.addEventListener("hashchange", readInvitationFragment);
    return () => window.removeEventListener("hashchange", readInvitationFragment);
  }, []);
  function continueSignIn() {
    if (audience === "owner") {
      ownerStart.mutate();
      return;
    }
    window.location.assign("/api/v1/auth/oidc/start");
  }
  return (
    <div className="sign-in-layout grid w-full min-w-0 grid-cols-[minmax(0,1fr)] min-h-dvh lg:grid-cols-2">
      <div className="sign-in-visual relative isolate flex min-w-0 flex-col overflow-hidden bg-zinc-950 p-6 text-white sm:p-10 lg:p-16">
        <WorkshopPicture />
        <div className="sign-in-image-wash absolute inset-0 z-10" aria-hidden="true" />
        <div className="relative z-20"><Brand dark /></div>
        <div className="relative z-20 w-full min-w-0 max-w-lg py-10 [overflow-wrap:anywhere] lg:pb-10 lg:pt-20">
          <div className="mb-5 flex w-fit max-w-full flex-wrap items-center gap-2 text-sm text-emerald-200 [overflow-wrap:anywhere]">
            <span className="size-1.5 rounded-full bg-emerald-400" />
            Raymond Gray VMMS
          </div>
          <h1 className="max-w-full text-balance text-3xl font-semibold leading-tight [overflow-wrap:anywhere] sm:text-4xl lg:text-5xl">
            Vehicle service portal
          </h1>
          <p className="mt-5 hidden max-w-sm text-pretty text-sm leading-6 text-zinc-200 sm:block lg:text-base lg:leading-7">
            Staff manage the work; approved vehicle owners can follow the
            service records shared with them.
          </p>
        </div>
        <div className="relative z-20 mt-auto hidden w-fit items-center gap-2 rounded-md bg-zinc-950/70 px-3 py-2 text-xs text-zinc-100 lg:flex">
          <ShieldCheck className="size-4" aria-hidden="true" />
          Individual account access
        </div>
      </div>
      <main className="flex items-center justify-center px-6 py-12 sm:px-12">
        <div className="w-full max-w-sm">
          <p className="text-sm text-zinc-500">Welcome to Raymond Gray</p>
          <h2 className="mt-2 text-3xl font-semibold text-zinc-950">
            {audience === "owner" ? "Vehicle owner sign in" : "Sign in to VMMS"}
          </h2>
          <p className="mt-3 text-pretty text-sm leading-6 text-zinc-500">
            {audience === "owner"
              ? "Continue with the account named in your invitation. Vehicle-owner access is approved by the service centre."
              : "Use your own approved team account, including on a shared computer. Continue to the secure sign-in page."}
          </p>
          <fieldset className="mb-6 mt-7">
            <legend className="text-sm font-medium text-zinc-800">I’m signing in as</legend>
            <div className="mt-3 grid grid-cols-2 gap-3">
              {signInAudiences.map((option) => (
                <label key={option} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-700">
                  <input
                    type="radio"
                    name="sign-in-audience"
                    value={option}
                    checked={audience === option}
                    onChange={() => setAudience(option)}
                    className="size-4 accent-emerald-700"
                  />
                  <span>{option === "staff" ? "Team member" : "Vehicle owner"}</span>
                </label>
              ))}
            </div>
          </fieldset>
          {signInResult === "not-approved" && (
            <p role="status" className="mb-5 rounded-md border-l-2 border-amber-500 bg-amber-50 px-3 py-2 text-sm text-amber-950">
              {audience === "owner"
                ? "This identity is not approved for vehicle-owner access. Contact the service centre that issued your invitation."
                : "Your identity is not approved for VMMS yet. Contact your service-centre administrator."}
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
          {invitationError && <p role="alert" className="mb-4 text-sm text-rose-800">{invitationError}</p>}
          {claimToken && <p role="status" className="mb-4 text-sm text-zinc-600">Invitation link ready. Continue with the account named in your invitation.</p>}
          <Button
            type="button"
            disabled={!online || ownerStart.isPending || Boolean(invitationError)}
            className="w-full"
            onClick={continueSignIn}
          >
            {ownerStart.isPending
              ? "Preparing secure sign-in…"
              : audience === "owner"
                ? claimToken ? "Continue with invitation" : "Continue as vehicle owner"
                : "Continue to secure sign-in"}
            <ArrowRight className="size-4" aria-hidden="true" />
          </Button>
          <FormError error={ownerStart.error} />
          <p className="mt-8 text-xs leading-5 text-zinc-500">
            {audience === "owner"
              ? "If you have not received an invitation, contact your vehicle service centre."
              : "Need team access? Contact your service-centre administrator."}
          </p>
        </div>
      </main>
    </div>
  );
}

function OwnerPortal() {
  const client = useQueryClient();
  const online = useOnline();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<unknown>(null);
  const vehicles = useQuery({
    queryKey: ["owner-vehicles"],
    queryFn: () => request("/owner/vehicles", ownerVehicleListSchema),
    enabled: online,
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
  async function signOut(destination: "staff" | "owner") {
    setSigningOut(true);
    setSignOutError(null);
    try {
      const result = await request("/auth/oidc/logout", rpLogoutResponseSchema, { method: "POST", body: { destination } });
      await client.cancelQueries();
      client.clear();
      try { clearAllWorkspaceDrafts(); } catch { /* Server sessions are already revoked. */ }
      notifyOtherTabsOfSignOut();
      window.location.replace(result.logoutUrl ?? "/signed-out?central=unavailable");
    } catch (error) {
      setSignOutError(error);
      setSigningOut(false);
    }
  }
  return (
    <div className="sign-in-layout grid w-full min-w-0 grid-cols-[minmax(0,1fr)] min-h-dvh lg:grid-cols-2">
      <div className="sign-in-visual relative isolate flex min-w-0 flex-col overflow-hidden bg-zinc-950 p-6 text-white sm:p-10 lg:p-16">
        <WorkshopPicture />
        <div className="absolute inset-0 -z-10 bg-zinc-950/20" aria-hidden="true" />
        <Brand dark compact />
        <div className="w-full min-w-0 max-w-lg py-10 [overflow-wrap:anywhere] lg:pb-10 lg:pt-20">
          <div className="mb-5 flex w-fit max-w-full flex-wrap items-center gap-2 text-sm text-emerald-200 [overflow-wrap:anywhere]">
            <span className="size-1.5 rounded-full bg-emerald-400" />
            Approved vehicle owner
          </div>
          <h1 className="max-w-full text-balance text-3xl font-semibold leading-tight [overflow-wrap:anywhere] sm:text-4xl lg:text-5xl">
            Your service records, when they’re ready to share.
          </h1>
        </div>
      </div>
      <main className="flex items-center justify-center px-6 py-12 sm:px-12">
        <section className="w-full max-w-xl">
          <p className="text-sm text-zinc-500">Vehicle owner access</p>
          <h2 className="mt-2 text-3xl font-semibold text-zinc-950">Your account is connected</h2>
          <section className="mt-6 border-l-2 border-emerald-700 pl-4" aria-labelledby="owner-vehicles-title">
            <h3 id="owner-vehicles-title" className="text-sm font-semibold text-zinc-900">Vehicles linked to your account</h3>
            <p className="mt-2 text-sm leading-6 text-zinc-600">Only vehicles approved for your account appear here. Service updates and documents are not available yet.</p>
            {!online ? (
              <p role="status" className="mt-4 text-sm text-amber-800">Connect to the internet to view your vehicles. Owner details are not saved for offline use.</p>
            ) : vehicles.isPending ? (
              <div className="mt-4"><Loading label="Loading your vehicles" /></div>
            ) : vehicles.isError ? (
              <div className="mt-4"><Failure error={vehicles.error} retry={() => { void vehicles.refetch(); }} /></div>
            ) : vehicles.data.vehicles.length ? (
              <ul className="mt-4 space-y-3" aria-label="Vehicles linked to your account">
                {vehicles.data.vehicles.map((vehicle) => (
                  <li key={vehicle.id} className="rounded-lg border border-zinc-200 border-l-2 border-l-emerald-700 bg-white p-4">
                    <h4 className="text-sm font-semibold text-zinc-900">{vehicle.make} {vehicle.model}</h4>
                    <p className="mt-2 text-sm text-zinc-600">Registration: <span className="font-medium text-zinc-800">{vehicle.registration || "Not recorded"}</span></p>
                  </li>
                ))}
              </ul>
            ) : (
              <p role="status" className="mt-4 text-sm text-zinc-600">No vehicles are currently available to this account. Contact your service centre for help.</p>
            )}
          </section>
          <div className="mt-8 flex flex-col items-start gap-3">
            <button type="button" className="min-h-11 text-left text-sm text-zinc-600 underline underline-offset-4 hover:text-zinc-950" onClick={() => { void signOut("staff"); }} disabled={signingOut}>
              {signingOut ? "Signing out…" : "Switch to team member sign in"}
            </button>
            <button type="button" className="flex min-h-11 items-center gap-2 text-sm text-zinc-600 hover:text-zinc-950" onClick={() => { void signOut("owner"); }} disabled={signingOut}>
              <LogOut className="size-4" aria-hidden="true" />
              {signingOut ? "Signing out…" : "Sign out of owner access"}
            </button>
            <FormError error={signOutError} />
          </div>
        </section>
      </main>
    </div>
  );
}

function SignOut({
  compact = false,
}: {
  compact?: boolean;
}) {
  const client = useQueryClient();
  const logout = useMutation({
    mutationFn: () => request("/auth/oidc/logout", rpLogoutResponseSchema, { method: "POST", body: { destination: "signed-out" } }),
    onSuccess: async (result) => {
      await client.cancelQueries();
      try { clearAllWorkspaceDrafts(); } catch { /* Server sessions are already revoked. */ }
      client.clear();
      notifyOtherTabsOfSignOut();
      window.location.replace(result.logoutUrl ?? "/signed-out?central=unavailable");
    },
  });
  return (
    <div>
      <button
        aria-label={logout.isPending ? "Signing out" : "Sign out"}
        className={cn(
          "flex min-h-11 items-center gap-2 text-sm",
          compact ? "text-zinc-400 hover:text-white" : "mt-6 text-zinc-600",
        )}
        onClick={() => logout.mutate()}
        disabled={logout.isPending}
      >
        <LogOut className="size-4" aria-hidden="true" />
        <span className="workspace-signout-label">{logout.isPending ? "Signing out…" : "Sign out"}</span>
      </button>
      <FormError error={logout.error} />
    </div>
  );
}

function Workspace({ session }: { session: StaffSession }) {
  const { siteId } = useParams();
  const site = session.sites.find((item) => item.id === siteId);
  const location = useLocation();
  const navigate = useNavigate();
  const client = useQueryClient();
  const online = useOnline();
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [navigationCollapsed, setNavigationCollapsed] = useState(false);
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const [moreExpanded, setMoreExpanded] = useState(false);
  if (!site) return <Navigate to="/" replace />;
  const capabilities = workspaceCapabilities(site);
  const accountOnly = capabilities.operatorOnly;
  const accountPath = `/sites/${site.id}/staff/accounts`;
  const documentsPath = `/sites/${site.id}/documents`;
  const documentsPage = location.pathname === documentsPath;
  const primaryPath = workspaceHomePath(site);
  const moreOpen = moreExpanded || location.pathname.includes("/overview") || location.pathname.includes("/activity") || location.pathname.includes("/my-tasks") || documentsPage || location.pathname.includes("/staff") || location.pathname.includes("/messages") || location.pathname.includes("/finance-setup");
  if (accountOnly && location.pathname !== accountPath && location.pathname !== `${accountPath}/` && !documentsPage) {
    return <Navigate to={accountPath} replace />;
  }
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
    const next = session.sites.find((item) => item.id === nextSite);
    if (next) navigate(workspaceHomePath(next));
  }
  return (
    <StaffContext.Provider value={{ session, site }}>
      <a className="skip-link" href="#workspace-main">
        Skip to content
      </a>
      <div id="workspace-shell" data-navigation-collapsed={navigationCollapsed} data-mobile-navigation-open={mobileNavigationOpen} className="min-h-dvh min-[900px]:grid min-[900px]:grid-cols-[272px_minmax(0,1fr)] min-[900px]:h-dvh min-[900px]:overflow-hidden">
        <aside id="workspace-navigation" className="workspace-sidebar sticky top-0 z-30 grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 self-start overscroll-contain bg-slate-950 px-4 py-3 text-slate-200 max-h-dvh overflow-y-auto min-[900px]:sticky min-[900px]:top-0 min-[900px]:flex min-[900px]:h-dvh min-[900px]:min-h-0 min-[900px]:flex-col min-[900px]:self-stretch min-[900px]:overflow-hidden min-[900px]:overscroll-contain min-[900px]:p-5">
          <Link
            to={primaryPath}
            className="workspace-brand-link col-start-1 row-start-1 min-w-0 min-[900px]:max-w-full"
          >
            <Brand dark />
          </Link>
          <button type="button" className="workspace-collapse-toggle hidden min-[900px]:inline-flex" aria-label={navigationCollapsed ? "Expand sidebar" : "Collapse sidebar"} aria-expanded={!navigationCollapsed} aria-controls="workspace-primary-navigation" title={navigationCollapsed ? "Expand sidebar" : "Collapse sidebar"} onClick={() => setNavigationCollapsed(value => !value)}>
            {navigationCollapsed ? <PanelLeftOpen className="size-5" aria-hidden="true" /> : <PanelLeftClose className="size-5" aria-hidden="true" />}
          </button>
          <button type="button" className="workspace-mobile-menu-toggle hidden" aria-label={mobileNavigationOpen ? "Close navigation menu" : "Open navigation menu"} aria-expanded={mobileNavigationOpen} aria-controls="workspace-primary-navigation" onClick={() => setMobileNavigationOpen(value => !value)}>
            {mobileNavigationOpen ? <X className="size-5" aria-hidden="true" /> : <Menu className="size-5" aria-hidden="true" />}<span>{mobileNavigationOpen ? "Close" : "Menu"}</span>
          </button>
          <div className="workspace-site-context col-span-2 row-start-2 min-w-0 min-[900px]:mt-7 min-[900px]:w-full min-[900px]:border-t min-[900px]:border-slate-700 min-[900px]:pt-5">
            <p className="workspace-site-kicker text-xs font-medium text-slate-400">WORKSPACE</p>
            <p className="workspace-site-name mt-1 truncate text-sm font-medium text-white min-[900px]:mt-2">{site.name}</p>
            <p className="workspace-site-code mt-1 hidden text-xs text-slate-400 min-[900px]:block">{site.code}</p>
          </div>
          <nav
            id="workspace-primary-navigation"
            aria-label="Primary navigation"
            className="workspace-primary-nav col-span-2 row-start-3 flex min-w-0 flex-wrap gap-2 min-[900px]:mt-5 min-[900px]:min-h-0 min-[900px]:w-full min-[900px]:flex-1 min-[900px]:flex-col min-[900px]:overflow-y-auto"
            onClick={(event) => {
              if ((event.target as HTMLElement).closest("a")) setMobileNavigationOpen(false);
            }}
          >
            {capabilities.canOpenToday && <NavLink end aria-label="Today" title="Today" to={`/sites/${site.id}/today`} className={({ isActive }) => cn("nav-link min-w-0 flex-1 basis-36 min-[900px]:flex-none", isActive && "nav-link-active")}>
              <Gauge className="size-4 shrink-0" aria-hidden="true" /><span className="workspace-nav-label">Today</span>
            </NavLink>}
            {capabilities.canOpenRequests && <NavLink aria-label="Requests and callbacks" title="Requests and callbacks" to={`/sites/${site.id}/requests`} className={({ isActive }) => cn("nav-link min-w-0 flex-1 basis-36 min-[900px]:flex-none", isActive && "nav-link-active")}>
              <ClipboardList className="size-4 shrink-0" aria-hidden="true" /><span className="workspace-nav-label">Requests and callbacks</span>
            </NavLink>}
            {capabilities.canOpenServiceHistory && <NavLink aria-label="Service history" title="Service history" to={`/sites/${site.id}/service-history`} className={({ isActive }) => cn("nav-link min-w-0 flex-1 basis-36 min-[900px]:flex-none", isActive && "nav-link-active")}>
              <ClipboardList className="size-4 shrink-0" aria-hidden="true" /><span className="workspace-nav-label">Service history</span>
            </NavLink>}
            {capabilities.canOpenWorkOrders && <NavLink aria-label="Work orders" title="Work orders" to={`/sites/${site.id}/work-orders`} className={({ isActive }) => cn("nav-link min-w-0 flex-1 basis-36 min-[900px]:flex-none", isActive && "nav-link-active")}>
              <ClipboardCheck className="size-4 shrink-0" aria-hidden="true" /><span className="workspace-nav-label">Work orders</span>
            </NavLink>}
            {capabilities.canOpenSalesDeliveries && <NavLink aria-label="Sales and PDI history" title="Sales and PDI history" to={`/sites/${site.id}/sales-deliveries`} className={({ isActive }) => cn("nav-link min-w-0 flex-1 basis-36 min-[900px]:flex-none", isActive && "nav-link-active")}>
              <CarFront className="size-4 shrink-0" aria-hidden="true" /><span className="workspace-nav-label">Sales and PDI history</span>
            </NavLink>}
            {(capabilities.canOpenHeadOverview || capabilities.canOpenMyTasks || capabilities.canOpenDocuments || capabilities.canManageTeam || capabilities.canSendStaffMessages || capabilities.canManageStaffAccounts || capabilities.canOpenVehicleLearning || capabilities.canOpenFinanceSetup) && <details open={moreOpen} onToggle={event => setMoreExpanded(event.currentTarget.open)} className="min-w-0 basis-full min-[900px]:basis-auto">
              <summary aria-label="More sections" title="More sections" className="nav-link min-h-11 cursor-pointer list-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white [&::-webkit-details-marker]:hidden"><BookOpen className="size-4 shrink-0" aria-hidden="true" /><span className="workspace-nav-label">More sections</span></summary>
              <div className="mt-2 flex min-w-0 flex-wrap gap-2 min-[900px]:flex-col">
                {capabilities.canOpenHeadOverview && <NavLink aria-label="Service-centre overview" title="Service-centre overview" to={`/sites/${site.id}/overview`} className={({ isActive }) => cn("nav-link min-w-0 flex-1 basis-36 min-[900px]:flex-none", isActive && "nav-link-active")}><Gauge className="size-4 shrink-0" aria-hidden="true" /><span className="workspace-nav-label">Service-centre overview</span></NavLink>}
                {capabilities.canOpenHeadOverview && <NavLink aria-label="Site activity" title="Site activity" to={`/sites/${site.id}/activity`} className={({ isActive }) => cn("nav-link min-w-0 flex-1 basis-36 min-[900px]:flex-none", isActive && "nav-link-active")}><Activity className="size-4 shrink-0" aria-hidden="true" /><span className="workspace-nav-label">Site activity</span></NavLink>}
                {capabilities.canOpenMyTasks && <NavLink aria-label="My assigned tasks" title="My assigned tasks" to={`/sites/${site.id}/my-tasks`} className={({ isActive }) => cn("nav-link min-w-0 flex-1 basis-36 min-[900px]:flex-none", isActive && "nav-link-active")}><ClipboardCheck className="size-4 shrink-0" aria-hidden="true" /><span className="workspace-nav-label">My assigned tasks</span></NavLink>}
                {capabilities.canOpenDocuments && <NavLink aria-label="Documents" title="Documents" to={documentsPath} className={({ isActive }) => cn("nav-link min-w-0 flex-1 basis-36 min-[900px]:flex-none", isActive && "nav-link-active")}><BookOpen className="size-4 shrink-0" aria-hidden="true" /><span className="workspace-nav-label">Documents</span></NavLink>}
                {capabilities.canOpenVehicleLearning && <NavLink aria-label="Vehicle learning" title="Vehicle learning" to={`/sites/${site.id}/vehicle-learning`} className={({ isActive }) => cn("nav-link min-w-0 flex-1 basis-36 min-[900px]:flex-none", isActive && "nav-link-active")}><BookOpen className="size-4 shrink-0" aria-hidden="true" /><span className="workspace-nav-label">Vehicle learning</span></NavLink>}
                {capabilities.canOpenFinanceSetup && <NavLink aria-label="Finance setup" title="Finance setup" to={`/sites/${site.id}/finance-setup`} className={({ isActive }) => cn("nav-link min-w-0 flex-1 basis-36 min-[900px]:flex-none", isActive && "nav-link-active")}><Settings2 className="size-4 shrink-0" aria-hidden="true" /><span className="workspace-nav-label">Finance setup</span></NavLink>}
                {capabilities.canManageTeam && <NavLink aria-label="People and roles" title="People and roles" to={`/sites/${site.id}/staff`} className={({ isActive }) => cn("nav-link min-w-0 flex-1 basis-36 min-[900px]:flex-none", isActive && "nav-link-active")}><UsersRound className="size-4 shrink-0" aria-hidden="true" /><span className="workspace-nav-label">People and roles</span></NavLink>}
                {capabilities.canSendStaffMessages && <NavLink aria-label="Staff messages" title="Staff messages" to={`/sites/${site.id}/messages`} className={({ isActive }) => cn("nav-link min-w-0 flex-1 basis-36 min-[900px]:flex-none", isActive && "nav-link-active")}><MessageSquareText className="size-4 shrink-0" aria-hidden="true" /><span className="workspace-nav-label">Staff messages</span></NavLink>}
                {capabilities.canManageStaffAccounts && <NavLink aria-label="Staff accounts" title="Staff accounts" to={accountPath} className={({ isActive }) => cn("nav-link min-w-0 flex-1 basis-36 min-[900px]:flex-none", isActive && "nav-link-active")}><UserRoundPlus className="size-4 shrink-0" aria-hidden="true" /><span className="workspace-nav-label">Staff accounts</span></NavLink>}
              </div>
            </details>}
          </nav>
          <div className="workspace-sidebar-account col-start-3 row-start-1 mt-0 min-w-0 min-[900px]:mt-auto min-[900px]:w-full min-[900px]:shrink-0 min-[900px]:border-t min-[900px]:border-slate-700 min-[900px]:pt-5">
            <p className="workspace-user-name hidden text-sm font-medium text-slate-100 min-[900px]:block">
              {session.user.displayName}
            </p>
            <p className="workspace-user-caption mt-1 hidden text-xs text-slate-400 min-[900px]:block">Personal staff account</p>
            <SignOut compact />
          </div>
        </aside>
        <div className="workspace-content min-w-0">
          <header className="flex min-h-20 flex-wrap items-center justify-between gap-3 border-b border-stone-200 bg-[#fbfaf7] px-5 py-3 sm:px-8 min-[900px]:sticky min-[900px]:top-0 min-[900px]:z-20">
            <div className="text-sm text-zinc-500">
              {documentsPage ? "Service-centre reference" : accountOnly ? "Account access" : "Raymond Gray VMMS"}
              <span className="mx-2 text-zinc-300">/</span>{" "}
                <span className="font-medium text-zinc-800">{workspacePageLabel(location.pathname, site.id)}</span>
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
            </div>
          </header>
          {!online && (
            <div
              role="status"
              className="border-b border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-900 sm:px-8"
            >
                {accountOnly
                  ? "Connection lost. Account requests need a connection and are not saved offline."
                  : "Connection lost. You can keep an intake draft in this tab. Server changes need a connection."}
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
            <Suspense fallback={<Loading label="Opening this workspace" />}>
              <Outlet key={site.id} />
            </Suspense>
          </main>
          <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200 px-5 py-5 text-xs text-zinc-600 sm:px-8">
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
