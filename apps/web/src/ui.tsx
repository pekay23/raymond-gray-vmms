import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { clsx } from "clsx";
import type { ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { AlertCircle, ArrowRight, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";
import { ApiError } from "./api";

export const cn = (...values: ClassValue[]) => twMerge(clsx(values));

type Toast = { id: string; message: string };
const ToastContext = createContext<(message: string) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const notify = useCallback((message: string) => {
    setToasts((current) => [...current, { id: crypto.randomUUID(), message }]);
  }, []);
  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={notify}>
      {children}
      <div
        className="pointer-events-none fixed right-4 top-4 z-50 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
        aria-live="polite"
        aria-atomic="false"
      >
        {toasts.map((toast) => (
          <ToastMessage key={toast.id} toast={toast} dismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastMessage({ toast, dismiss }: { toast: Toast; dismiss: (id: string) => void }) {
  const [visible, setVisible] = useState(false);
  const [paused, setPaused] = useState(false);
  const closeTimer = useRef<number | null>(null);
  const closing = useRef(false);
  const focusReturnTarget = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setVisible(true));
    if (paused) return () => window.cancelAnimationFrame(frame);
    const hide = window.setTimeout(() => setVisible(false), 5000);
    const remove = window.setTimeout(() => dismiss(toast.id), 5160);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(hide);
      window.clearTimeout(remove);
    };
  }, [dismiss, paused, toast.id]);

  useEffect(() => () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
  }, []);

  function close() {
    if (closing.current) return;
    closing.current = true;
    setVisible(false);
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.closest('.toast')) {
      const previous = focusReturnTarget.current;
      const previousCanReceiveFocus = Boolean(previous?.isConnected
        && previous.getClientRects().length > 0
        && !previous.matches(':disabled')
        && !previous.closest('[hidden],[inert],[aria-hidden="true"]')
        && getComputedStyle(previous).visibility !== 'hidden');
      if (previousCanReceiveFocus && previous) {
        previous.focus({ preventScroll: true });
      } else {
        const main = document.querySelector<HTMLElement>('#workspace-main, main');
        if (main) {
          if (!main.hasAttribute('tabindex')) main.tabIndex = -1;
          main.focus({ preventScroll: true });
        }
      }
    }
    closeTimer.current = window.setTimeout(() => dismiss(toast.id), 160);
  }

  return (
    <div
      role="status"
      data-visible={visible}
      onFocusCapture={(event) => {
        const relatedTarget = event.relatedTarget;
        const focusStayedInside = relatedTarget instanceof Node && event.currentTarget.contains(relatedTarget);
        if (!focusStayedInside && relatedTarget instanceof HTMLElement && relatedTarget !== document.body) {
          focusReturnTarget.current = relatedTarget;
        }
        setPaused(true);
      }}
      onBlurCapture={(event) => {
        const relatedTarget = event.relatedTarget;
        if (!(relatedTarget instanceof Node) || !event.currentTarget.contains(relatedTarget)) setPaused(false);
      }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className="toast pointer-events-auto flex items-start justify-between gap-4 rounded-lg border border-emerald-200 border-l-2 border-l-emerald-600 bg-white px-4 py-3 text-sm text-zinc-800 shadow-lg"
    >
      <span>{toast.message}</span>
      <button className="shrink-0 text-zinc-500 hover:text-zinc-900" onClick={close} aria-label="Dismiss notification">
        <span aria-hidden="true">×</span>
      </button>
    </div>
  );
}

export function Button({
  className,
  variant = "primary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger";
}) {
  return (
    <button
      className={cn(
        "button",
        variant === "primary" && "button-primary",
        variant === "secondary" && "button-secondary",
        variant === "danger" && "button-danger",
        className,
      )}
      {...props}
    />
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "warning" | "danger" | "green";
}) {
  return (
    <span
      className={cn(
        "badge",
        tone === "warning" && "badge-warning",
        tone === "danger" && "badge-danger",
        tone === "green" && "badge-green",
      )}
    >
      {children}
    </span>
  );
}

export function FormError({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <div role="alert" className="error-box">
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div>
        <p>
          {error instanceof Error
            ? error.message
            : "This change could not be saved."}
        </p>
        {error instanceof ApiError &&
          Object.entries(error.fields).length > 0 && (
            <ul className="mt-2 list-inside list-disc text-sm">
              {Object.entries(error.fields).map(([field, messages]) => (
                <li key={field}>
                  {field}:{" "}
                  {Array.isArray(messages) ? messages.join(" ") : messages}
                </li>
              ))}
            </ul>
          )}
        {error instanceof ApiError && error.status === 409 && (
          <p className="mt-2 text-sm">
            Review the current work order before retrying. Your form entries
            have been kept.
          </p>
        )}
      </div>
    </div>
  );
}

export function Loading({
  label = "Loading the workspace",
}: {
  label?: string;
}) {
  return (
    <div className="space-y-4" role="status">
      <p className="text-sm text-zinc-500">{label}…</p>
      <div className="h-28 rounded-xl border border-zinc-200 bg-white" />
      <div className="h-44 rounded-xl border border-zinc-200 bg-white" />
    </div>
  );
}

export function Failure({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  return (
    <div className="panel p-6">
      <FormError error={error} />
      <Button variant="secondary" onClick={retry} className="mt-4">
        <RefreshCw className="size-4" aria-hidden="true" />
        Try again
      </Button>
    </div>
  );
}

export function Empty({
  title,
  children,
  href,
  action,
}: {
  title: string;
  children: ReactNode;
  href?: string;
  action?: string;
}) {
  return (
    <div className="py-12 text-center">
      <h2 className="text-lg font-semibold text-zinc-900">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-zinc-500">
        {children}
      </p>
      {href && (
        <Link className="button button-primary mt-6" to={href}>
          {action}
          <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      )}
    </div>
  );
}

function subscribeOnline(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}
export function useOnline() {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}

export { formatDateTime as dateTime } from "./formatting";

export function PageHeading({
  eyebrow,
  title,
  children,
  action,
}: {
  eyebrow: string;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="mb-2 text-xs font-semibold uppercase text-zinc-600">
          {eyebrow}
        </p>
        <h1 className="text-balance text-3xl font-semibold text-zinc-950 sm:text-4xl">
          {title}
        </h1>
        {children && (
          <p className="mt-3 max-w-2xl text-pretty text-sm leading-6 text-zinc-600">
            {children}
          </p>
        )}
      </div>
      {action}
    </header>
  );
}
