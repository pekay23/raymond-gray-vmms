import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import {
  ApiError,
  detailSchema,
  orderPath,
  request,
  supervisorTaskActivityPageSchema,
  supervisorTaskActivityPath,
  taskAllocationsPath,
  taskAllocationsSchema,
} from "../api";
import { useStaff } from "../workspace";
import { Button, dateTime, Failure, Loading } from "../ui";

const PAGE_SIZE = 50;
const MAX_REPORT_PAGES = 100;

type TaskActivityReport = {
  audience: "supervisor" | "team-lead" | "head-service-centre";
  planRevisionId: string;
  planRevisionNumber: number | null;
  tasks: Array<{
    taskId: string;
    reference: string;
    title: string;
    assigneeName: string | null;
    assignmentRevision: number | null;
  }>;
  items: Array<{
    id: string;
    taskId: string;
    taskReference: string;
    taskTitle: string;
    currentAssigneeName: string;
    currentAssignmentRevision: number;
    assignmentRevision: number;
    entryType: "acknowledgement" | "progress" | "request" | "comment";
    progressState: "working" | "waiting" | "blocked" | null;
    requestType: "help" | "parts" | "information" | "access" | "evidence" | null;
    note: string;
    actorName: string;
    createdAt: string;
  }>;
  totalItems: number;
  preparedAt: string;
};

async function readProgressReport(siteId: string, orderId: string): Promise<TaskActivityReport> {
  const allocations = await request(taskAllocationsPath(siteId, orderId), taskAllocationsSchema);
  if (!allocations.activityAudience || !allocations.planRevisionId) {
    throw new ApiError(
      "Task updates are available to the current Supervisor, assigned Team Lead and Head of Service Centre after the current work has been handed over.",
      403,
      "task_activity_read_required",
    );
  }

  const firstPage = await request(
    supervisorTaskActivityPath(siteId, orderId, 1, PAGE_SIZE),
    supervisorTaskActivityPageSchema,
  );
  if (firstPage.planRevisionId !== allocations.planRevisionId) {
    throw new ApiError("The work plan changed while this report was being prepared. Reload the work order and try again.", 409, "report_plan_changed");
  }
  if (firstPage.pagination.totalPages > MAX_REPORT_PAGES) {
    throw new ApiError("This work order has too many updates for one printable report. Ask an administrator for a filtered report.", 413, "report_too_large");
  }

  const items = [...firstPage.items];
  for (let page = 2; page <= firstPage.pagination.totalPages; page += 1) {
    const result = await request(
      supervisorTaskActivityPath(siteId, orderId, page, PAGE_SIZE),
      supervisorTaskActivityPageSchema,
    );
    if (result.planRevisionId !== firstPage.planRevisionId || result.pagination.totalItems !== firstPage.pagination.totalItems) {
      throw new ApiError("Task updates changed while this report was being prepared. Reload the work order and try again.", 409, "report_activity_changed");
    }
    items.push(...result.items);
  }

  const finalAllocations = await request(taskAllocationsPath(siteId, orderId), taskAllocationsSchema);
  const assignmentsChanged = finalAllocations.tasks.length !== allocations.tasks.length
    || allocations.tasks.some((task) => {
      const latest = finalAllocations.tasks.find((candidate) => candidate.taskId === task.taskId);
      return !latest || latest.assigneeId !== task.assigneeId || latest.assignmentRevision !== task.assignmentRevision;
    });
  if (finalAllocations.activityAudience !== allocations.activityAudience
    || finalAllocations.planRevisionId !== allocations.planRevisionId
    || assignmentsChanged) {
    throw new ApiError("The work plan or task assignments changed while this report was being prepared. Reload the work order and try again.", 409, "report_assignments_changed");
  }

  return {
    audience: allocations.activityAudience,
    planRevisionId: allocations.planRevisionId,
    planRevisionNumber: allocations.planRevisionNumber,
    tasks: allocations.tasks,
    items: items.sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt) || left.id.localeCompare(right.id)),
    totalItems: firstPage.pagination.totalItems,
    preparedAt: new Date().toISOString(),
  };
}

export function PrintTaskProgressReport() {
  const { site } = useStaff();
  const { orderId } = useParams();
  const orderQuery = useQuery({
    queryKey: ["task-progress-report-order", site.id, orderId],
    queryFn: () => request(orderPath(site.id, orderId ?? ""), detailSchema),
    enabled: Boolean(orderId),
    retry: false,
  });
  const reportQuery = useQuery({
    queryKey: ["task-progress-report", site.id, orderId],
    queryFn: () => readProgressReport(site.id, orderId ?? ""),
    enabled: Boolean(orderId),
    retry: false,
  });

  useEffect(() => {
    if (!orderQuery.data) return;
    const previousTitle = document.title;
    document.title = `Work order ${orderQuery.data.reference} task progress`;
    return () => { document.title = previousTitle; };
  }, [orderQuery.data]);

  if (orderQuery.isPending || reportQuery.isPending) return <Loading label="Preparing task progress report" />;
  if (orderQuery.isError || reportQuery.isError || !orderQuery.data || !reportQuery.data) {
    return <Failure error={orderQuery.error ?? reportQuery.error ?? new Error("This progress report could not be prepared.")} retry={() => { void orderQuery.refetch(); void reportQuery.refetch(); }} />;
  }

  const order = orderQuery.data;
  const report = reportQuery.data;
  if (!order.workPlan || order.workPlan.id !== report.planRevisionId) {
    return <Failure error={new ApiError("The work plan changed while this report was being prepared. Reload the work order and try again.", 409, "report_plan_changed")} retry={() => { void orderQuery.refetch(); void reportQuery.refetch(); }} />;
  }
  return (
    <main className="task-progress-report-page min-h-screen bg-zinc-100 px-4 py-6 sm:px-8">
      <div className="task-progress-report-toolbar mx-auto mb-5 flex max-w-4xl flex-wrap items-center justify-between gap-3">
        <Link className="button button-secondary" to={`/sites/${encodeURIComponent(site.id)}/work-orders/${encodeURIComponent(order.id)}`}>
          Back to work order
        </Link>
        <Button type="button" onClick={() => window.print()}>Print progress report</Button>
      </div>

      <article className="task-progress-report mx-auto max-w-4xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-10" aria-labelledby="task-progress-report-title">
        <header className="border-b-2 border-zinc-900 pb-6">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-zinc-600">Raymond Gray · {site.name}</p>
              <h1 id="task-progress-report-title" className="mt-3 text-2xl font-semibold text-zinc-950 sm:text-3xl">Work order progress report</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-600">A record of task assignments and updates shared by the workshop team.</p>
            </div>
            <div className="min-w-52 border-l-4 border-sky-700 pl-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Booking reference</p>
              <p className="mt-1 font-mono text-xl font-semibold tabular-nums text-zinc-950">{order.reference}</p>
              <p className="mt-2 text-sm font-medium text-zinc-700">Work plan version {report.planRevisionNumber ?? "Not recorded"}</p>
            </div>
          </div>
          <dl className="mt-6 grid grid-cols-2 gap-4 border-t border-zinc-200 pt-4 text-sm sm:grid-cols-4">
            <Meta label="Vehicle" value={`${order.vehicle.make} ${order.vehicle.model}${order.vehicle.variant ? ` · ${order.vehicle.variant}` : ""}`} />
            <Meta label="Registration" value={order.vehicle.registration || "Not recorded"} />
            <Meta label="Work updates" value={report.totalItems.toLocaleString("en-GH")} />
            <Meta label="Report prepared" value={dateTime(report.preparedAt, site.timeZone)} />
          </dl>
        </header>

        <section className="task-progress-report-section mt-7" aria-labelledby="progress-plan-title">
          <SectionTitle id="progress-plan-title" number="01" title="Tasks in this work plan" />
          {report.tasks.length === 0 ? <p className="text-sm text-zinc-600">No tasks are listed in the current work plan.</p> : (
            <ol className="space-y-3">
              {report.tasks.map((task) => <li key={task.taskId} className="keep-together border-l-2 border-zinc-300 pl-4">
                <p className="text-sm font-semibold text-zinc-950"><span className="font-mono text-zinc-500">{task.reference}</span> · {task.title}</p>
                <p className="mt-1 text-sm text-zinc-700">{task.assigneeName ? `Assigned to ${task.assigneeName}` : "No team member assigned"}</p>
              </li>)}
            </ol>
          )}
        </section>

        <section className="task-progress-report-section mt-7" aria-labelledby="progress-updates-title">
          <SectionTitle id="progress-updates-title" number="02" title="Updates from the team" />
          {report.items.length === 0 ? <p className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-600">No updates have been recorded for the current handed-over work plan.</p> : (
            <ol className="space-y-4">
              {report.items.map((item) => <li key={item.id} className="keep-together border-l-4 border-sky-700 pl-4">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <h3 className="text-sm font-semibold text-zinc-950"><span className="font-mono text-zinc-500">{item.taskReference}</span> · {item.taskTitle}</h3>
                  <time className="text-xs text-zinc-600" dateTime={item.createdAt}>{dateTime(item.createdAt, site.timeZone)}</time>
                </div>
                <p className="mt-1 text-sm font-medium text-zinc-800">{activityLabel(item)}</p>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-zinc-700">{item.note}</p>
                <p className="mt-1 text-xs text-zinc-500">Recorded by {item.actorName} · assignment version {item.assignmentRevision}</p>
              </li>)}
            </ol>
          )}
        </section>

        <footer className="mt-8 border-t-2 border-zinc-900 pt-4 text-xs leading-5 text-zinc-700">
          <p className="font-semibold">Internal workshop report</p>
          <p className="mt-1">These entries record team acknowledgements, progress, requests and comments. They do not confirm that repairs are complete, provide inspection or release approval, confirm payment, or authorize vehicle collection.</p>
          <p className="mt-2">Prepared from the current handed-over work plan. This report does not include updates from earlier or replaced work plans.</p>
        </footer>
      </article>
    </main>
  );
}

function activityLabel(item: TaskActivityReport["items"][number]) {
  if (item.entryType === "acknowledgement") return "Task acknowledged";
  if (item.entryType === "progress") return `Progress · ${progressLabel(item.progressState)}`;
  if (item.entryType === "request") return `Request · ${requestLabel(item.requestType)}`;
  return "Comment";
}

function progressLabel(state: TaskActivityReport["items"][number]["progressState"]) {
  if (state === "working") return "In progress";
  if (state === "waiting") return "Waiting";
  if (state === "blocked") return "Blocked";
  return "Not stated";
}

function requestLabel(requestType: TaskActivityReport["items"][number]["requestType"]) {
  if (requestType === "help") return "Help";
  if (requestType === "parts") return "Parts";
  if (requestType === "information") return "Information";
  if (requestType === "access") return "Access";
  if (requestType === "evidence") return "Evidence";
  return "Not stated";
}

function SectionTitle({ id, number, title }: { id: string; number: string; title: string }) {
  return <h2 id={id} className="mb-4 flex items-baseline gap-3 border-b border-zinc-200 pb-2 text-lg font-semibold text-zinc-950"><span className="font-mono text-xs text-zinc-500">{number}</span>{title}</h2>;
}

function Meta({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{label}</dt><dd className="mt-1 break-words font-medium text-zinc-900">{value}</dd></div>;
}
