import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowRight, ClipboardList, FileText, UsersRound } from "lucide-react";
import { ApiError, request, workforceOverviewPath, workforceOverviewSchema } from "../api";
import { dateTime, Failure, Loading, PageHeading, useOnline } from "../ui";
import { useStaff } from "../workspace";

function Metric({ label, value, href }: { label: string; value: number; href?: string }) {
  return (
    <div className="panel min-w-0 p-5 sm:p-6">
      <dt className="text-sm leading-5 text-zinc-600">
        {href ? (
          <Link to={href} className="inline-flex min-h-6 items-center gap-2 underline decoration-zinc-300 underline-offset-4 hover:text-blue-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700">
            {label}<ArrowRight className="size-3.5" aria-hidden="true" />
          </Link>
        ) : label}
      </dt>
      <dd className="mt-3 text-3xl font-semibold tabular-nums text-zinc-950 sm:text-4xl">
        {value.toLocaleString("en-GH")}
      </dd>
    </div>
  );
}

export function HeadOverview() {
  const { site } = useStaff();
  const online = useOnline();
  const overview = useQuery({
    queryKey: ["workforce-overview", site.id],
    queryFn: () => request(workforceOverviewPath(site.id), workforceOverviewSchema),
    enabled: online,
    retry: false,
    refetchOnWindowFocus: true,
  });

  if (!online) {
    return (
      <section className="panel max-w-3xl border-l-2 border-l-amber-600 p-6" aria-labelledby="overview-offline">
        <p className="text-xs font-semibold uppercase text-amber-800">Connection needed</p>
        <h1 id="overview-offline" className="mt-2 text-xl font-semibold text-zinc-950">Overview is unavailable offline</h1>
        <p className="mt-2 text-sm leading-6 text-zinc-600">Reconnect to see current service-centre work and staffing figures. This page does not save changes.</p>
      </section>
    );
  }

  if (overview.isPending) return <Loading label="Loading the service-centre overview" />;

  if (overview.isError) {
    if (overview.error instanceof ApiError && overview.error.status === 403) {
      return (
        <section className="panel max-w-2xl border-l-2 border-l-zinc-500 p-6" aria-labelledby="overview-restricted">
          <p className="text-xs font-semibold uppercase text-zinc-500">Staff access</p>
          <h1 id="overview-restricted" className="mt-2 text-xl font-semibold text-zinc-950">This overview is for the Head of Service Centre</h1>
          <p className="mt-2 text-sm leading-6 text-zinc-600">Your access has not changed. Open the work orders available to your role or ask your Head if you need an update.</p>
          <Link className="button button-secondary mt-5 inline-flex" to={`/sites/${site.id}/work-orders`}>
            Go to work orders <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </section>
      );
    }
    return <Failure error={overview.error} retry={() => void overview.refetch()} />;
  }

  const data = overview.data;
  if (!data) return <Loading label="Loading the service-centre overview" />;

  return (
    <>
      <PageHeading eyebrow="Service-centre operations" title="Head overview" action={
        <Link className="button button-secondary" to={`/sites/${site.id}/overview/print`}>
          <FileText className="size-4" aria-hidden="true" />
          <span>Print report</span>
        </Link>
      }>
        A current view of open work, review queues and staff at {site.name}.
      </PageHeading>

      <section aria-labelledby="work-summary-title" className="mb-8">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="work-summary-title" className="text-lg font-semibold text-zinc-950">Work orders</h2>
            <p className="mt-1 text-sm text-zinc-600">Current jobs and the next operations steps.</p>
          </div>
          <Link className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-zinc-700 hover:text-zinc-950" to={`/sites/${site.id}/work-orders`}>
            Open work orders <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </div>
        <dl className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <Metric label="Active jobs" value={data.workOrders.active} href={`/sites/${site.id}/work-orders`} />
          <Metric label="Jobs on hold" value={data.workOrders.held} href={`/sites/${site.id}/work-orders?queue=held`} />
          <Metric label="Awaiting Operations review" value={data.workOrders.awaitingOperationsReview} href={`/sites/${site.id}/work-orders?queue=awaiting-operations`} />
          <Metric label="Awaiting team-lead assignment" value={data.workOrders.awaitingTeamLead} href={`/sites/${site.id}/work-orders?queue=awaiting-lead`} />
          <Metric label="Assigned to a team lead" value={data.workOrders.assignedToTeamLead} href={`/sites/${site.id}/work-orders?queue=assigned`} />
        </dl>
        {data.workOrders.active === 0 && (
          <p className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-600" role="status">
            There are no active jobs at this service centre right now.
          </p>
        )}
      </section>

      <section aria-labelledby="task-progress-title" className="mb-8">
        <div className="mb-4">
          <h2 id="task-progress-title" className="text-lg font-semibold text-zinc-950">Reported task blockers and waits</h2>
          <p className="mt-1 text-sm text-zinc-600">These counts use each assigned task’s latest progress report in current handed-over plans. They show what was last reported, not live safety, completion or staff availability.</p>
        </div>
        <dl className="mb-4 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="panel border-l-4 border-l-red-700 p-4">
            <dt className="text-sm text-zinc-600">Last reported blocked</dt>
            <dd className="mt-2 text-2xl font-semibold tabular-nums text-zinc-950">{data.taskProgress.blockedCount.toLocaleString("en-GH")}</dd>
          </div>
          <div className="panel border-l-4 border-l-amber-600 p-4">
            <dt className="text-sm text-zinc-600">Last reported waiting</dt>
            <dd className="mt-2 text-2xl font-semibold tabular-nums text-zinc-950">{data.taskProgress.waitingCount.toLocaleString("en-GH")}</dd>
          </div>
        </dl>
        {data.taskProgress.items.length === 0 ? (
          <p className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-600" role="status">No current task has a latest progress report marked blocked or waiting.</p>
        ) : (
          <ol className="grid gap-3 lg:grid-cols-2">
            {data.taskProgress.items.map(item => (
              <li key={`${item.workOrderId}:${item.taskReference}`} className={`panel min-w-0 border-l-4 p-4 ${item.state === "blocked" ? "border-l-red-700" : "border-l-amber-600"}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2 py-1 text-xs font-semibold ${item.state === "blocked" ? "bg-red-50 text-red-800" : "bg-amber-50 text-amber-900"}`}>
                    {item.state === "blocked" ? "Last reported blocked" : "Last reported waiting"}
                  </span>
                  <span className="text-xs text-zinc-600">{dateTime(item.reportedAt, site.timeZone)}</span>
                </div>
                <h3 className="mt-3 break-words text-sm font-semibold text-zinc-950">{item.taskReference} · {item.taskTitle}</h3>
                <p className="mt-1 break-words text-sm text-zinc-600">{item.bookingReference} · Assigned to {item.assigneeName}</p>
                <Link className="mt-3 inline-flex min-h-11 items-center gap-2 text-sm font-medium text-blue-800 underline underline-offset-4 hover:text-blue-950" to={`/sites/${site.id}/work-orders/${encodeURIComponent(item.workOrderId)}`}>
                  Open work order <ArrowRight className="size-4" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ol>
        )}
        {data.taskProgress.blockedCount + data.taskProgress.waitingCount > data.taskProgress.items.length && (
          <p className="mt-3 text-xs text-zinc-600">Showing the first {data.taskProgress.items.length} current reports. Open work orders for their task history.</p>
        )}
      </section>

      <section aria-labelledby="staff-summary-title">
        <div className="mb-4">
          <h2 id="staff-summary-title" className="text-lg font-semibold text-zinc-950">Staffing</h2>
          <p className="mt-1 text-sm text-zinc-600">Current staff access and role assignments at this service centre.</p>
        </div>
        <dl className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
          <Metric label="Active staff accounts" value={data.staff.active} />
          <Metric label="Active staff role assignments" value={data.staff.activeRolePlacements} />
        </dl>
        <Link className="button button-secondary mt-5 inline-flex" to={`/sites/${site.id}/staff`}>
          <UsersRound className="size-4" aria-hidden="true" />
          View staff and roles
        </Link>
      </section>

      <p className="mt-8 flex items-center gap-2 text-xs text-zinc-600" aria-live="polite">
        <ClipboardList className="size-3.5" aria-hidden="true" />
        Updated {dateTime(data.asOf, site.timeZone)}
      </p>
    </>
  );
}
