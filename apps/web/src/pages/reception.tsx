import { useState } from "react";
import type { FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  CircleAlert,
  FilePlus2,
  Search,
  ShieldAlert,
} from "lucide-react";
import { Link } from "react-router-dom";
import { listSchema, request, sitePath } from "../api";
import { useStaff } from "../workspace";
import {
  Badge,
  Button,
  Empty,
  Failure,
  Loading,
  PageHeading,
  dateTime,
} from "../ui";

export function Reception() {
  const { site } = useStaff();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const orders = useQuery({
    queryKey: ["work-orders", site.id, query],
    queryFn: () =>
      request(
        `${sitePath(site.id)}/work-orders?q=${encodeURIComponent(query)}`,
        listSchema,
      ),
  });
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setQuery(search.trim());
  }
  return (
    <>
      <PageHeading
        eyebrow="Service advisor"
        title="Work orders"
        action={
          site.canWrite && (
            <Link
              to={`/sites/${site.id}/intake`}
              className="button button-primary"
            >
              <FilePlus2 className="size-4" aria-hidden="true" />
              New intake
            </Link>
          )
        }
      >
        A shared record for every visit. Start at reception and keep each
        concern attached to the same work order.
      </PageHeading>
      {orders.isPending ? (
        <Loading label="Loading work orders" />
      ) : orders.isError ? (
        <Failure
          error={orders.error}
          retry={() => {
            void orders.refetch();
          }}
        />
      ) : (
        <>
          <dl className="mb-7 grid gap-4 sm:grid-cols-3">
            <div className="panel px-5 py-5">
              <dt className="text-sm text-zinc-500">Open work orders</dt>
              <dd className="mt-2 text-3xl font-semibold tabular-nums text-zinc-950">
                {orders.data.totals.open}
              </dd>
              <p className="mt-2 text-xs text-zinc-500">
                At this service centre
              </p>
            </div>
            <div className="panel px-5 py-5">
              <dt className="flex items-center gap-2 text-sm text-zinc-500">
                <ShieldAlert className="size-4" aria-hidden="true" />
                With open holds
              </dt>
              <dd className="mt-2 text-3xl font-semibold tabular-nums text-zinc-950">
                {orders.data.totals.held}
              </dd>
              <p className="mt-2 text-xs text-zinc-500">
                A reason and owner recorded
              </p>
            </div>
            <div className="panel px-5 py-5">
              <dt className="text-sm text-zinc-500">Reception drafts</dt>
              <dd className="mt-2 text-3xl font-semibold tabular-nums text-zinc-950">
                {orders.data.totals.intakeDrafts}
              </dd>
              <p className="mt-2 text-xs text-zinc-500">
                Intake evidence still pending
              </p>
            </div>
          </dl>
          <section className="panel" aria-labelledby="queue-title">
            <div className="panel-heading">
              <div>
                <h2 id="queue-title" className="section-title">
                  Reception queue
                </h2>
                <p className="mt-1 text-xs text-zinc-500">
                  Updated {dateTime(orders.data.asOf)}
                </p>
              </div>
              <form onSubmit={submit} className="flex w-full gap-2 sm:max-w-sm">
                <label htmlFor="queue-search" className="sr-only">
                  Search work orders
                </label>
                <div className="relative min-w-0 flex-1">
                  <Search
                    className="pointer-events-none absolute left-3 top-3.5 size-4 text-zinc-500"
                    aria-hidden="true"
                  />
                  <input
                    id="queue-search"
                    type="search"
                    placeholder="Reference, VIN, vehicle or customer"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    className="pl-9"
                    maxLength={200}
                  />
                </div>
                <Button type="submit" variant="secondary">
                  Search
                </Button>
              </form>
            </div>
            {orders.data.items.length === 0 ? (
              <Empty
                title={
                  query
                    ? "No matching work orders"
                    : "Ready for the first vehicle"
                }
                {...(!query && site.canWrite
                  ? {
                      href: `/sites/${site.id}/intake`,
                      action: "Start an intake",
                    }
                  : {})}
              >
                {query
                  ? "Try a different reference, registration, VIN or customer name."
                  : "Create a reception draft to record the vehicle and the customer’s first concern."}
              </Empty>
            ) : (
              <>
                <div className="hidden grid-cols-12 gap-4 border-b border-zinc-100 px-6 py-3 text-xs font-medium text-zinc-500 md:grid">
                  <span className="col-span-2">Work order</span>
                  <span className="col-span-4">Vehicle</span>
                  <span className="col-span-3">Customer</span>
                  <span className="col-span-3">Status</span>
                </div>
                <ul className="divide-y divide-zinc-100">
                  {orders.data.items.map((order) => (
                    <li key={order.id}>
                      <Link
                        to={`/sites/${site.id}/work-orders/${order.id}`}
                        className="grid gap-3 px-5 py-5 hover:bg-zinc-50 sm:px-6 md:grid-cols-12 md:items-center md:gap-4"
                      >
                        <div className="md:col-span-2">
                          <p className="font-mono text-sm font-semibold tabular-nums text-zinc-900">
                            {order.reference}
                          </p>
                          <p className="mt-1 text-xs text-zinc-500">
                            {order.complaintCount}{" "}
                            {order.complaintCount === 1
                              ? "concern"
                              : "concerns"}
                          </p>
                        </div>
                        <div className="md:col-span-4">
                          <p className="text-sm font-semibold text-zinc-800">
                            {order.vehicleLabel}
                          </p>
                          <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-500">
                            <span>{order.registration}</span>
                            <span className="font-mono tabular-nums">
                              {order.vin}
                            </span>
                          </p>
                        </div>
                        <div className="text-sm text-zinc-600 md:col-span-3">
                          {order.customerName}
                        </div>
                        <div className="flex flex-wrap items-center gap-2 md:col-span-3">
                          <Badge>Reception draft</Badge>
                          {order.openHoldCount > 0 && (
                            <Badge tone="warning">
                              <CircleAlert
                                className="size-3"
                                aria-hidden="true"
                              />
                              {order.openHoldCount}{" "}
                              {order.openHoldCount === 1 ? "hold" : "holds"}
                            </Badge>
                          )}
                          <ArrowRight
                            className="ml-auto size-4 text-zinc-500"
                            aria-hidden="true"
                          />
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
                <div className="border-t border-zinc-100 px-6 py-3 text-xs text-zinc-500">
                  Showing {orders.data.items.length}{" "}
                  {orders.data.items.length === 1 ? "record" : "records"}.
                  Results are limited to the newest 100.
                </div>
              </>
            )}
          </section>
          <div className="mt-5 flex items-start gap-2 text-xs leading-5 text-zinc-500">
            <ShieldAlert
              className="mt-0.5 size-4 shrink-0"
              aria-hidden="true"
            />
            <p>
              Reception drafts do not authorise diagnosis, repair or release.
              Each gate needs its own evidence and decision.
            </p>
          </div>
        </>
      )}
    </>
  );
}
