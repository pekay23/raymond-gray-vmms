import { useSyncExternalStore } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { clsx } from "clsx";
import type { ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { AlertCircle, ArrowRight, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";
import { ApiError } from "./api";

export const cn = (...values: ClassValue[]) => twMerge(clsx(values));

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

const dateFormatter = new Intl.DateTimeFormat("en-GH", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Africa/Accra",
});
export function dateTime(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf())
    ? "Time unavailable"
    : dateFormatter.format(parsed);
}

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
        <p className="mb-2 text-xs font-semibold uppercase text-zinc-500">
          {eyebrow}
        </p>
        <h1 className="text-balance text-3xl font-semibold text-zinc-950 sm:text-4xl">
          {title}
        </h1>
        {children && (
          <p className="mt-3 max-w-2xl text-pretty text-sm leading-6 text-zinc-500">
            {children}
          </p>
        )}
      </div>
      {action}
    </header>
  );
}
