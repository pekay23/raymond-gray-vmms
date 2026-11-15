import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  CircleAlert,
  FilePlus2,
  Search,
  ShieldAlert,
} from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
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

type Queue = "all" | "operations" | "awaiting-operations" | "held" | "awaiting-lead" | "assigned" | "team-lead" | "supervisor";
const queueLabels: Record<Queue, string> = {
  all: "All work orders at this service centre",
  operations: "Jobs for Operations review or lead assignment",
  "awaiting-operations": "Jobs awaiting Operations review",
  held: "Jobs with an open hold",
  "awaiting-lead": "Jobs awaiting team-lead assignment",
  assigned: "Jobs assigned to a team lead",
  "team-lead": "Jobs assigned to me as team lead",
  supervisor: "Jobs assigned to me",
};

export function Reception() {
  const { site } = useStaff();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const requestedQueue = searchParams.get("queue");
  const queue = requestedQueue && Object.hasOwn(queueLabels, requestedQueue)
    ? requestedQueue as Queue
    : "all";
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const orders = useQuery({
    queryKey: ["work-orders", site.id, queue, query, page, pageSize],
    queryFn: () => {
      const params = new URLSearchParams({ q: query, queue, page: String(page), pageSize: String(pageSize) });
      return request(`${sitePath(site.id)}/work-orders?${params}`, listSchema);
    },
  });
  useEffect(() => {
    const actualPage = orders.data?.pagination.page;
    if (actualPage !== undefined && actualPage !== page) setPage(actualPage);
  }, [orders.data?.pagination.page, page]);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setQuery(search.trim());
    setPage(1);
  }
  function selectQueue(nextQueue: Queue) {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (nextQueue === "all") next.delete("queue");
      else next.set("queue", nextQueue);
      return next;
    });
    setPage(1);
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
              Register a vehicle visit
            </Link>
          )
        }
      >
        Each vehicle visit has one work order. Add every concern from that visit to the same record.
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
              <dd className="mt-2 text-xs text-zinc-500">
                At this service centre
              </dd>
            </div>
            <div className="panel px-5 py-5">
              <dt className="flex items-center gap-2 text-sm text-zinc-500">
                <ShieldAlert className="size-4" aria-hidden="true" />
                With open holds
              </dt>
              <dd className="mt-2 text-3xl font-semibold tabular-nums text-zinc-950">
                {orders.data.totals.held}
              </dd>
              <dd className="mt-2 text-xs text-zinc-500">
                A reason and responsible staff member are recorded
              </dd>
            </div>
            <div className="panel px-5 py-5">
              <dt className="text-sm text-zinc-500">Visit drafts</dt>
              <dd className="mt-2 text-3xl font-semibold tabular-nums text-zinc-950">
                {orders.data.totals.intakeDrafts}
              </dd>
              <dd className="mt-2 text-xs text-zinc-500">
                Handover details, condition photos or safety checks still needed
              </dd>
            </div>
          </dl>
          <section className="panel" aria-labelledby="queue-title" aria-busy={orders.isFetching}>
            <div className="panel-heading">
              <div>
                <h2 id="queue-title" className="section-title">
                  {queueLabels[queue]}
                </h2>
                <p className="mt-1 text-xs text-zinc-500">
                  Updated {dateTime(orders.data.asOf, site.timeZone)}
                </p>
              </div>
              <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:flex-wrap sm:items-end">
              <label htmlFor="queue-filter" className="mb-0 flex w-full flex-col gap-1 text-xs font-medium text-zinc-600 sm:w-auto">
                Show jobs
                <select
                  id="queue-filter"
                  value={queue}
                  onChange={(event) => selectQueue(event.target.value as Queue)}
                  className="min-h-11 w-full sm:min-w-52"
                >
                  {(Object.keys(queueLabels) as Queue[]).map((value) => (
                    <option key={value} value={value}>{queueLabels[value]}</option>
                  ))}
                </select>
              </label>
              <form onSubmit={submit} className="flex w-full gap-2 sm:w-auto sm:max-w-sm">
                <label htmlFor="queue-search" className="sr-only">
                  Search by booking number, vehicle ID, registration or client
                </label>
                <div className="relative min-w-0 flex-1">
                  <Search
                    className="pointer-events-none absolute left-3 top-3.5 size-4 text-zinc-500"
                    aria-hidden="true"
                  />
                  <input
                    id="queue-search"
                    type="search"
                    placeholder="Booking no., vehicle ID, registration or client"
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
            </div>
            {orders.isFetching && (
              <p role="status" className="border-b border-zinc-100 px-5 py-3 text-sm text-zinc-600 sm:px-6">
                Updating work orders…
              </p>
            )}
            {orders.data.items.length === 0 ? (
              <Empty
                title={
                  query
                    ? "No matching work orders"
                    : queue === "all"
                      ? "Ready for the first vehicle"
                      : `No work orders in ${queueLabels[queue].toLowerCase()}`
                }
                {...(!query && queue === "all" && site.canWrite
                  ? {
                      href: `/sites/${site.id}/intake`,
                      action: "Start an intake",
                    }
                  : {})}
              >
                {query
                  ? "Try a different booking number, vehicle identification number, registration or client name."
                  : queue === "all"
                    ? "Create a reception draft to record the vehicle and the customer’s first concern."
                    : "New work will appear here when it reaches this stage or is assigned to your account."}
              </Empty>
            ) : (
              <>
                <div className="hidden grid-cols-12 gap-4 border-b border-zinc-100 px-6 py-3 text-xs font-medium text-zinc-500 md:grid">
                  <span className="col-span-2">Work order</span>
                  <span className="col-span-4">Vehicle</span>
                  <span className="col-span-3">Paying client</span>
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
                            <span>{order.registration || "Registration not recorded"}</span>
                            <span className="font-mono tabular-nums">
                              {order.vin}
                            </span>
                          </p>
                        </div>
                        <div className="text-sm text-zinc-600 md:col-span-3">
                          {order.clientName ?? "Paying client not recorded"}
                        </div>
                        <div className="flex flex-wrap items-center gap-2 md:col-span-3">
                          <Badge>Visit draft</Badge>
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
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 px-5 py-3 text-xs text-zinc-600 sm:px-6">
                  <p role="status" aria-live="polite">
                    Showing {(orders.data.pagination.page - 1) * orders.data.pagination.pageSize + 1}
                    –{(orders.data.pagination.page - 1) * orders.data.pagination.pageSize + orders.data.items.length}
                    {" of "}{orders.data.pagination.totalItems} work orders · Page {orders.data.pagination.page} of {orders.data.pagination.totalPages}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="mb-0 flex items-center gap-2 text-xs font-normal text-zinc-600" htmlFor="queue-page-size">
                      Rows per page
                      <select
                        id="queue-page-size"
                        className="min-h-10 w-auto py-2 text-xs"
                        value={pageSize}
                        onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}
                      >
                        <option value={25}>25</option>
                        <option value={50}>50</option>
                        <option value={100}>100</option>
                      </select>
                    </label>
                    <Button type="button" variant="secondary" disabled={orders.data.pagination.page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>
                      Previous
                    </Button>
                    <Button type="button" variant="secondary" disabled={orders.data.pagination.page >= orders.data.pagination.totalPages} onClick={() => setPage((current) => current + 1)}>
                      Next
                    </Button>
                  </div>
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
              A visit draft does not allow diagnosis, repair or vehicle release. Each gate needs its own evidence and decision.
            </p>
          </div>
        </>
      )}
    </>
  );
}
