import { ArrowRight, BookOpen, CarFront, ClipboardList, ClipboardCheck, FilePlus2, Gauge, MessageSquareText } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";
import { Link } from "react-router-dom";
import { diagnosticReviewQueuePath, diagnosticReviewQueueSchema, listSchema, myAssignedTasksPath, myAssignedTasksSchema, request, sitePath, taskReviewQueuePath, taskReviewQueueSchema } from "../api";
import { Failure, Loading, PageHeading, dateTime, useOnline } from "../ui";
import { useStaff } from "../workspace";
import { todayWorkQueues, workspaceCapabilities, type TodayWorkQueue } from "../workspace-navigation";
import { ChecklistReviewQueue } from "../checklist-review-queue";

const callbackListSchema = z.object({
  items: z.array(z.object({
    id: z.string().uuid(),
    concern: z.string(),
    reportedVehicle: z.string().nullable(),
    nextAction: z.string().nullable(),
    callbackDueAt: z.string().nullable(),
  })),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  totalCount: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
});

type Action = {
  title: string;
  description: string;
  href: string;
  action: string;
  icon: typeof ClipboardList;
};

export function Today() {
  const { site } = useStaff();
  const capabilities = workspaceCapabilities(site);
  const base = `/sites/${site.id}`;
  const actions: Action[] = [];

  if (capabilities.canOpenRequests) {
    actions.push({
      title: "Requests and callbacks",
      description: "Record a concern or follow up on a request you can access.",
      href: `${base}/requests`,
      action: "Open requests",
      icon: MessageSquareText,
    });
  }
  if (capabilities.canOpenWorkOrders) {
    actions.push({
      title: "Work orders",
      description: "Continue with the jobs and updates available to your role.",
      href: `${base}/work-orders`,
      action: "Open work orders",
      icon: ClipboardList,
    });
  }
  if (capabilities.canOpenMyTasks) {
    actions.push({
      title: "My assigned tasks",
      description: "Review your current assignments and record progress or requests.",
      href: `${base}/my-tasks`,
      action: "Open my tasks",
      icon: ClipboardCheck,
    });
  }
  if (capabilities.canOpenVehicleHistory) {
    actions.push({
      title: "Sales and PDI history",
      description: "Review recorded deliveries, PDI observations and available vehicle history.",
      href: `${base}/sales-deliveries`,
      action: "Open vehicles",
      icon: CarFront,
    });
  }
  if (capabilities.canOpenHeadOverview) {
    actions.push({
      title: "Service-centre overview",
      description: "Review the current service-centre overview and reports.",
      href: `${base}/overview`,
      action: "Open overview",
      icon: Gauge,
    });
  }
  if (capabilities.canRegisterVisit && site.canWrite) {
    actions.push({
      title: "Register a vehicle visit",
      description: "Record a vehicle that has arrived at the service centre.",
      href: `${base}/intake`,
      action: "Start intake",
      icon: FilePlus2,
    });
  }
  if (capabilities.canOpenDocuments) {
    actions.push({
      title: "Documents",
      description: "Read current service-centre documents available to your role.",
      href: `${base}/documents`,
      action: "Open documents",
      icon: BookOpen,
    });
  }

  return (
    <>
      <PageHeading eyebrow={site.name} title="Today">
        Start with what needs your attention.
      </PageHeading>
      {capabilities.canOpenRequests && <CallbacksDue />}
      <TodayWorkQueuePreview queues={todayWorkQueues(site.roleCodes)} />
      <section aria-labelledby="today-work-areas" className="space-y-4">
        <h2 id="today-work-areas" className="text-base font-semibold text-zinc-950">Your work areas</h2>
        <ul className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {actions.map(({ title, description, href, action, icon: Icon }) => (
            <li key={href} className="min-w-0">
              <article className="panel flex h-full min-w-0 flex-col p-5">
                <div className="flex items-start gap-3">
                  <Icon className="mt-0.5 size-5 shrink-0 text-zinc-600" aria-hidden="true" />
                  <div className="min-w-0">
                    <h3 className="text-base font-semibold text-zinc-950">{title}</h3>
                    <p className="mt-2 text-pretty text-sm leading-6 text-zinc-600">{description}</p>
                  </div>
                </div>
                <Link className="mt-5 inline-flex min-h-11 items-center gap-2 self-start rounded-md font-semibold text-blue-800 underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-800" to={href}>
                  {action}<ArrowRight className="size-4" aria-hidden="true" />
                </Link>
              </article>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

function TodayWorkQueuePreview({ queues }: { queues: TodayWorkQueue[] }) {
  if (queues.length === 0) return null;
  return (
    <section aria-labelledby="today-work-queue-title" className="mb-7 space-y-4">
      <div>
        <h2 id="today-work-queue-title" className="text-lg font-semibold text-zinc-950">Work needing your attention</h2>
        <p className="mt-1 text-sm text-zinc-600">These lists follow the roles active for your selected service centre.</p>
      </div>
      <div className="grid min-w-0 gap-4 xl:grid-cols-2">
        {queues.map((queue) => queue.kind === "work-orders"
          ? <WorkOrderQueuePreview key={queue.key} queue={queue} />
          : queue.kind === "task-reviews"
            ? <TaskReviewQueuePreview key={queue.key} queue={queue} />
            : queue.kind === "diagnostic-reviews"
              ? <DiagnosticReviewQueuePreview key={queue.key} queue={queue} />
              : queue.kind === "checklist-reviews"
                ? <ChecklistReviewQueue key={queue.key} />
              : <AssignedTaskQueuePreview key={queue.key} queue={queue} />)}
      </div>
    </section>
  );
}

function DiagnosticReviewQueuePreview({ queue }: { queue: Extract<TodayWorkQueue, { kind: "diagnostic-reviews" }> }) {
  const { site } = useStaff();
  const online = useOnline();
  const [page, setPage] = useState(1);
  const pageSize = 5;
  const query = useQuery({
    queryKey: ["today-diagnostic-review-findings", site.id, page],
    queryFn: () => request(diagnosticReviewQueuePath(site.id, page, pageSize), diagnosticReviewQueueSchema),
    enabled: online,
    retry: false,
  });
  const base = sitePath(site.id);

  return (
    <article className="panel min-w-0 border-l-4 border-l-sky-700 p-5" aria-labelledby="today-diagnostic-review-queue">
      <div className="min-w-0">
        <h3 id="today-diagnostic-review-queue" className="font-semibold text-zinc-950">{queue.title}</h3>
        <p className="mt-1 text-sm text-zinc-600">{queue.description}</p>
      </div>
      <p className="mt-3 border-l-2 border-sky-500 pl-3 text-xs leading-5 text-zinc-600">A finding is a recorded observation. It does not approve a repair, clear a risk or sign off work.</p>
      <div className="mt-4">
        {!online && !query.data ? (
          <p role="status" className="border-l-2 border-amber-600 pl-3 text-sm text-zinc-700">Reconnect to load diagnostic findings.</p>
        ) : query.isPending ? (
          <Loading label="Loading diagnostic findings" />
        ) : query.isError ? (
          <Failure error={query.error} retry={() => void query.refetch()} />
        ) : (
          <>
            {!online && <p role="status" className="mb-3 border-l-2 border-amber-600 pl-3 text-sm text-zinc-700">Offline — showing the last loaded findings.</p>}
            {query.data.items.length === 0 ? (
              <p className="text-sm text-zinc-600">No diagnostic findings are recorded for your current review scope.</p>
            ) : (
              <ul className="divide-y divide-zinc-200">
                {query.data.items.map((item) => (
                  <li key={item.findingId} className="min-w-0 py-3 first:pt-0 last:pb-0">
                    <Link className="font-semibold text-blue-800 underline underline-offset-4" to={`${base}/work-orders/${item.workOrderId}`}>
                      {item.bookingReference} · {item.complaintReference}{item.taskReference ? ` · ${item.taskReference}` : ""} · {queue.action}
                    </Link>
                    <p className="mt-1 break-words text-sm text-zinc-800">{item.summary}</p>
                    <p className="mt-1 break-words text-xs text-zinc-600">{item.vehicleLabel}{item.registration ? ` · ${item.registration}` : ""} · {item.certaintyState === "inconclusive" ? "Inconclusive" : "Reported or observed"} · {dateTime(item.recordedAt, site.timeZone)}</p>
                    <p className="mt-2 break-words text-sm leading-5 text-zinc-700"><span className="font-semibold">Remaining risk:</span> {item.residualRisk}</p>
                    {item.restrictions && <p className="mt-1 break-words text-sm leading-5 text-amber-900"><span className="font-semibold">Restriction:</span> {item.restrictions}</p>}
                    <p className="mt-1 break-words text-xs text-zinc-600">Certainty: {item.certaintyExplanation}{item.taskTitle ? ` · Task: ${item.taskTitle}` : ""}</p>
                  </li>
                ))}
              </ul>
            )}
            {query.data.pagination.totalPages > 1 && (
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button className="button button-secondary" type="button" disabled={page <= 1} onClick={() => setPage(value => Math.max(1, value - 1))}>Previous</button>
                <span role="status" className="text-sm text-zinc-600">Page {query.data.pagination.page} of {query.data.pagination.totalPages} · {query.data.pagination.totalItems} findings</span>
                <button className="button button-secondary" type="button" disabled={page >= query.data.pagination.totalPages} onClick={() => setPage(value => value + 1)}>Next</button>
              </div>
            )}
          </>
        )}
      </div>
    </article>
  );
}

function TaskReviewQueuePreview({ queue }: { queue: Extract<TodayWorkQueue, { kind: "task-reviews" }> }) {
  const { site } = useStaff();
  const online = useOnline();
  const [page, setPage] = useState(1);
  const pageSize = 5;
  const query = useQuery({
    queryKey: ["today-task-review-requests", site.id, page],
    queryFn: () => request(taskReviewQueuePath(site.id, page, pageSize), taskReviewQueueSchema),
    enabled: online,
    retry: false,
  });
  const base = sitePath(site.id);

  return (
    <article className="panel min-w-0 border-l-4 border-l-violet-700 p-5" aria-labelledby="today-task-review-queue">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id="today-task-review-queue" className="font-semibold text-zinc-950">{queue.title}</h3>
          <p className="mt-1 text-sm text-zinc-600">{queue.description}</p>
        </div>
      </div>
      <p className="mt-3 border-l-2 border-violet-500 pl-3 text-xs leading-5 text-zinc-600">A review request asks for guidance. It does not mark work complete or authorize a repair.</p>
      <div className="mt-4">
        {!online && !query.data ? (
          <p role="status" className="border-l-2 border-amber-600 pl-3 text-sm text-zinc-700">Reconnect to check for new review requests.</p>
        ) : query.isPending ? (
          <Loading label="Loading Technician review requests" />
        ) : query.isError ? (
          <Failure error={query.error} retry={() => void query.refetch()} />
        ) : (
          <>
            {!online && <p role="status" className="mb-3 border-l-2 border-amber-600 pl-3 text-sm text-zinc-700">Offline — showing the last loaded list. Reconnect before responding.</p>}
            {query.data.items.length === 0 ? (
              <p className="text-sm text-zinc-600">No Technician review requests are waiting for a response.</p>
            ) : (
              <ul className="divide-y divide-zinc-200">
                {query.data.items.map((item) => (
                  <li key={item.activityId} className="min-w-0 py-3 first:pt-0 last:pb-0">
                    <Link className="font-semibold text-blue-800 underline underline-offset-4" to={`${base}/work-orders/${item.workOrderId}`}>
                      {item.bookingReference} · {item.taskReference} · {queue.action}
                    </Link>
                    <p className="mt-1 break-words text-sm text-zinc-800">{item.taskTitle}</p>
                    <p className="mt-1 break-words text-xs text-zinc-600">{item.vehicleLabel}{item.registration ? ` · ${item.registration}` : ""} · Requested by {item.requesterName}</p>
                    <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-zinc-700">{item.note}</p>
                    <p className="mt-1 text-xs text-zinc-500">Technician: {item.technicianName} · {dateTime(item.createdAt, site.timeZone)}</p>
                  </li>
                ))}
              </ul>
            )}
            {query.data.pagination.totalPages > 1 && (
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button className="button button-secondary" type="button" disabled={page <= 1} onClick={() => setPage(value => Math.max(1, value - 1))}>Previous</button>
                <span role="status" className="text-sm text-zinc-600">Page {query.data.pagination.page} of {query.data.pagination.totalPages} · {query.data.pagination.totalItems} waiting</span>
                <button className="button button-secondary" type="button" disabled={page >= query.data.pagination.totalPages} onClick={() => setPage(value => value + 1)}>Next</button>
              </div>
            )}
          </>
        )}
      </div>
    </article>
  );
}

function WorkOrderQueuePreview({ queue }: { queue: Extract<TodayWorkQueue, { kind: "work-orders" }> }) {
  const { site } = useStaff();
  const online = useOnline();
  const base = sitePath(site.id);
  const query = useQuery({
    queryKey: ["today-work-orders", site.id, queue.queue],
    queryFn: () => request(`${base}/work-orders?queue=${queue.queue}&page=1&pageSize=4`, listSchema),
    enabled: online,
    retry: false,
  });

  return (
    <article className="panel min-w-0 border-l-4 border-l-blue-700 p-5" aria-labelledby={`today-queue-${queue.key}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id={`today-queue-${queue.key}`} className="font-semibold text-zinc-950">{queue.title}</h3>
          <p className="mt-1 text-sm text-zinc-600">{queue.description}</p>
        </div>
        <Link className="min-h-11 inline-flex shrink-0 items-center font-semibold text-blue-800 underline underline-offset-4" to={`${base}/work-orders?queue=${queue.queue}`}>
          View all
        </Link>
      </div>
      <div className="mt-4">
        {!online && !query.data ? (
          <p role="status" className="border-l-2 border-amber-600 pl-3 text-sm text-zinc-700">Reconnect to load this queue. Changes must be made online.</p>
        ) : query.isPending ? (
          <Loading label={`Loading ${queue.title.toLowerCase()}`} />
        ) : query.isError ? (
          <Failure error={query.error} retry={() => void query.refetch()} />
        ) : (
          <>
            {!online && <p role="status" className="mb-3 border-l-2 border-amber-600 pl-3 text-sm text-zinc-700">Offline — showing the last loaded list. Reconnect before acting.</p>}
            {query.data.items.length === 0 ? (
              <p className="text-sm text-zinc-600">No jobs are waiting in this list.</p>
            ) : (
              <ul className="divide-y divide-zinc-200">
                {query.data.items.map((item) => (
                  <li key={item.id} className="min-w-0 py-3 first:pt-0 last:pb-0">
                    <Link className="font-semibold text-blue-800 underline underline-offset-4" to={`${base}/work-orders/${item.id}`}>
                      {item.reference} · {queue.action}
                    </Link>
                    <p className="mt-1 break-words text-sm text-zinc-800">{item.vehicleLabel}{item.registration ? ` · ${item.registration}` : ""}</p>
                    <p className="mt-1 text-xs text-zinc-600">{item.complaintCount} {item.complaintCount === 1 ? "concern" : "concerns"}{item.openHoldCount > 0 ? ` · ${item.openHoldCount} hold${item.openHoldCount === 1 ? "" : "s"} recorded` : ""}</p>
                  </li>
                ))}
              </ul>
            )}
            {query.data.pagination.totalItems > 4 && <p className="mt-3 text-xs text-zinc-600">Showing 4 of {query.data.pagination.totalItems} jobs.</p>}
          </>
        )}
      </div>
    </article>
  );
}

function AssignedTaskQueuePreview({ queue }: { queue: Extract<TodayWorkQueue, { kind: "assigned-tasks" }> }) {
  const { site } = useStaff();
  const online = useOnline();
  const query = useQuery({
    queryKey: ["today-assigned-tasks", site.id],
    queryFn: () => request(myAssignedTasksPath(site.id, "", 1, 4), myAssignedTasksSchema),
    enabled: online,
    retry: false,
  });
  return (
    <article className="panel min-w-0 border-l-4 border-l-amber-600 p-5" aria-labelledby={`today-queue-${queue.key}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id={`today-queue-${queue.key}`} className="font-semibold text-zinc-950">{queue.title}</h3>
          <p className="mt-1 text-sm text-zinc-600">{queue.description}</p>
        </div>
        <Link className="min-h-11 inline-flex shrink-0 items-center font-semibold text-blue-800 underline underline-offset-4" to={`${sitePath(site.id)}/my-tasks`}>
          {queue.action}
        </Link>
      </div>
      <div className="mt-4">
        {!online && !query.data ? (
          <p role="status" className="border-l-2 border-amber-600 pl-3 text-sm text-zinc-700">Reconnect to load your assigned tasks.</p>
        ) : query.isPending ? (
          <Loading label="Loading your assigned tasks" />
        ) : query.isError ? (
          <Failure error={query.error} retry={() => void query.refetch()} />
        ) : (
          <>
            {!online && <p role="status" className="mb-3 border-l-2 border-amber-600 pl-3 text-sm text-zinc-700">Offline — showing the last loaded list. Reconnect before recording progress.</p>}
            {query.data.items.length === 0 ? (
              <p className="text-sm text-zinc-600">No active tasks are assigned to you.</p>
            ) : (
              <ul className="divide-y divide-zinc-200">
                {query.data.items.map((item) => (
                  <li key={`${item.workOrderId}-${item.taskId}`} className="min-w-0 py-3 first:pt-0 last:pb-0">
                    <p className="font-mono text-xs text-zinc-600">{item.bookingReference} · {item.taskReference}</p>
                    <p className="mt-1 break-words text-sm font-semibold text-zinc-950">{item.taskTitle}</p>
                    <p className="mt-1 break-words text-sm text-zinc-700">{item.vehicleLabel}{item.registration ? ` · ${item.registration}` : ""}</p>
                  </li>
                ))}
              </ul>
            )}
            {query.data.pagination.totalItems > 4 && <p className="mt-3 text-xs text-zinc-600">Showing 4 of {query.data.pagination.totalItems} tasks.</p>}
          </>
        )}
      </div>
    </article>
  );
}

function CallbacksDue() {
  const { site } = useStaff();
  const base = `${sitePath(site.id)}/service-requests`;
  const overdue = useQuery({
    queryKey: ["today-callbacks", site.id, "overdue"],
    queryFn: () => request(`${base}?filter=overdue&page=1&pageSize=4`, callbackListSchema),
  });
  const dueToday = useQuery({
    queryKey: ["today-callbacks", site.id, "due-today"],
    queryFn: () => request(`${base}?filter=due-today&page=1&pageSize=4`, callbackListSchema),
  });

  return (
    <section aria-labelledby="today-callbacks-title" className="panel mb-7 min-w-0 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="today-callbacks-title" className="text-lg font-semibold text-zinc-950">Callbacks due</h2>
        <Link className="font-semibold text-blue-800 underline underline-offset-4" to={`/sites/${site.id}/requests`}>
          Open requests
        </Link>
      </div>
      {overdue.isPending || dueToday.isPending ? (
        <Loading label="Loading callbacks" />
      ) : overdue.isError ? (
        <Failure error={overdue.error} retry={() => void overdue.refetch()} />
      ) : dueToday.isError ? (
        <Failure error={dueToday.error} retry={() => void dueToday.refetch()} />
      ) : overdue.data.totalCount === 0 && dueToday.data.totalCount === 0 ? (
        <p className="mt-3 text-sm text-zinc-600">No overdue callbacks or callbacks due today.</p>
      ) : (
        <div className="mt-4 grid min-w-0 gap-5 lg:grid-cols-2">
          <CallbackGroup label="Overdue" filter="overdue" siteId={site.id} timeZone={site.timeZone} list={overdue.data} />
          <CallbackGroup label="Due today" filter="due-today" siteId={site.id} timeZone={site.timeZone} list={dueToday.data} />
        </div>
      )}
    </section>
  );
}

function CallbackGroup({
  label,
  filter,
  siteId,
  timeZone,
  list,
}: {
  label: string;
  filter: "overdue" | "due-today";
  siteId: string;
  timeZone: string;
  list: z.infer<typeof callbackListSchema>;
}) {
  const visible = list.items.slice(0, 4);
  return (
    <div className="min-w-0">
      <h3 className="font-semibold text-zinc-900">{label} <span className="font-normal text-zinc-600">({list.totalCount})</span></h3>
      {visible.length === 0 ? (
        <p className="mt-2 text-sm text-zinc-600">None.</p>
      ) : (
        <ul className="mt-2 divide-y divide-zinc-200">
          {visible.map((item) => (
            <li key={item.id} className="min-w-0 py-3">
              <Link
                className="font-semibold text-blue-800 underline underline-offset-4"
                to={`/sites/${siteId}/requests?request=${encodeURIComponent(item.id)}&filter=${filter}`}
              >
                {item.nextAction || "Review the request"}
              </Link>
              <p className="mt-1 break-words text-sm text-zinc-800">{item.concern}</p>
              <p className="mt-1 break-words text-sm text-zinc-600">
                {item.reportedVehicle || "Vehicle not confirmed"}
                {item.callbackDueAt ? ` · ${dateTime(item.callbackDueAt, timeZone)}` : " · Callback time not recorded"}
              </p>
            </li>
          ))}
        </ul>
      )}
      {list.totalCount > visible.length && (
        <Link className="mt-2 inline-flex min-h-11 items-center gap-2 font-semibold text-blue-800 underline underline-offset-4" to={`/sites/${siteId}/requests?filter=${filter}`}>
          See all {label.toLowerCase()} callbacks <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      )}
    </div>
  );
}
