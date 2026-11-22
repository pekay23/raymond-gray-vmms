import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, FileText } from "lucide-react";
import { Link } from "react-router-dom";
import { ApiError, request, supervisorTaskActivityPageSchema, supervisorTaskActivityPath, supervisorTaskReviewReplyPath, taskActivityResultSchema, taskAllocationResultSchema, taskAllocationsPath, taskAllocationsSchema } from "./api";
import { useStaff } from "./workspace";
import { Badge, Button, dateTime, Failure, FormError, Loading, useOnline, useToast } from "./ui";

type Props = {
  siteId: string;
  workOrderId: string;
  workOrderVersion: number;
};

type CommandAttempt = {
  id: string;
  content: string;
  body: {
    expectedVersion: number;
    planRevisionId: string;
    assignments: Array<{ taskId: string; staffUserId: string }>;
  };
};

const blockMessages: Record<NonNullable<ReturnType<typeof taskAllocationsSchema.parse>["blockReason"]>, string> = {
  "handoff-required": "Only the Supervisor currently assigned to this work can change task assignments.",
  "current-plan-required": "The Team Lead needs to save a current work plan before tasks can be assigned.",
  "operations-review-required": "Operations needs to review the current work before tasks can be assigned.",
  "no-direct-reports": "No active Technician, Engineer or Trainee currently reports directly to this Supervisor.",
  "site-write-required": "Your site access is read-only, so assignments cannot be changed.",
};

type ActivityAudience = "supervisor" | "team-lead" | "head-service-centre";

type SupervisorActivityItem = (typeof supervisorTaskActivityPageSchema)['_output']['items'][number];

function SupervisorReviewReply({ siteId, workOrderId, planRevisionId, item }: {
  siteId: string;
  workOrderId: string;
  planRevisionId: string;
  item: SupervisorActivityItem;
}) {
  const client = useQueryClient();
  const notify = useToast();
  const [note, setNote] = useState("");
  const attempt = useRef<{ id: string; body: Record<string, unknown> } | null>(null);
  const reply = useMutation({
    mutationFn: () => {
      if (!attempt.current) attempt.current = {
        id: crypto.randomUUID(),
        body: { expectedWorkPlanRevisionId: planRevisionId, expectedAssignmentRevision: item.currentAssignmentRevision, note: note.trim() },
      };
      return request(supervisorTaskReviewReplyPath(siteId, workOrderId, item.taskId, item.id), taskActivityResultSchema,
        { method: "POST", commandId: attempt.current.id, body: attempt.current.body });
    },
    onSuccess: async () => {
      attempt.current = null;
      setNote("");
      notify("Response recorded. It does not sign off or complete work.");
      await Promise.all([
        client.invalidateQueries({ queryKey: ["supervisor-task-activity", siteId, workOrderId] }),
        client.invalidateQueries({ queryKey: ["today-task-review-requests", siteId] }),
      ]);
    },
    onError: error => {
      if (error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== 408) attempt.current = null;
    },
  });
  if (item.entryType !== "request" || item.requestType !== "supervisor-review") return null;
  if (item.assignmentRevision !== item.currentAssignmentRevision) {
    return <p className="mt-3 text-xs text-amber-900">This request belongs to an earlier assignment and cannot be answered.</p>;
  }
  if (item.hasSupervisorResponse) return <p className="mt-3 text-xs font-medium text-emerald-800">A response is recorded for this request.</p>;
  if (reply.isSuccess) return null;
  return (
    <form className="mt-3 grid gap-2 rounded-md border border-sky-200 bg-sky-50/60 p-3" onSubmit={event => { event.preventDefault(); reply.mutate(); }}>
      <label className="text-xs font-semibold text-zinc-800" htmlFor={`review-reply-${item.id}`}>Reply to this review request</label>
      <textarea id={`review-reply-${item.id}`} rows={2} maxLength={1500} required value={note} onChange={event => setNote(event.target.value)} />
      {reply.isError && <p role="alert" className="text-sm text-red-800">{reply.error.message}</p>}
      <Button type="submit" variant="secondary" disabled={reply.isPending || !note.trim()}>{reply.isPending ? "Sending response…" : "Send response"}</Button>
      <p className="text-xs leading-5 text-zinc-600">This response does not approve repairs, complete the task or replace Supervisor sign-off.</p>
    </form>
  );
}

function SupervisorTaskActivity({ siteId, workOrderId, audience }: { siteId: string; workOrderId: string; audience: ActivityAudience }) {
  const { site } = useStaff();
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const updates = useQuery({
    queryKey: ["supervisor-task-activity", siteId, workOrderId, page, pageSize],
    queryFn: () => request(supervisorTaskActivityPath(siteId, workOrderId, page, pageSize), supervisorTaskActivityPageSchema),
    enabled: true,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  useEffect(() => setPage(1), [workOrderId]);
  const pagination = updates.data?.pagination;

  return (
    <section className="border-t border-zinc-200 pt-5" aria-labelledby="supervisor-task-activity-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 id="supervisor-task-activity-heading" className="text-base font-semibold text-zinc-950">Task updates from the team</h3>
          <p className="mt-1 text-sm text-zinc-600">
            {audience === "supervisor" ? "Updates from workers who report directly to you." : "Updates from the current work plan."} A review reply does not sign off work.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {pagination && pagination.totalItems > 0 && <span className="text-xs text-zinc-500" aria-live="polite">{pagination.totalItems} {pagination.totalItems === 1 ? "update" : "updates"}</span>}
          <Link className="button button-secondary" to={`/sites/${encodeURIComponent(siteId)}/work-orders/${encodeURIComponent(workOrderId)}/progress-report`}>
            <FileText className="size-4" aria-hidden="true" /> Progress report
          </Link>
        </div>
      </div>
      {updates.isPending ? (
        <div className="mt-3"><Loading label="Loading team task updates" /></div>
      ) : updates.isError ? (
        <div className="mt-3"><Failure error={updates.error} retry={() => { void updates.refetch(); }} /></div>
      ) : updates.data.items.length === 0 ? (
        <p className="mt-3 rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-600">No updates from the team yet.</p>
      ) : (
        <>
          <ol className="mt-3 divide-y divide-zinc-200 rounded-lg border border-zinc-200" aria-label="Team task update history" aria-busy={updates.isFetching}>
            {updates.data.items.map(item => (
              <li key={item.id} className="grid min-w-0 gap-2 border-l-4 border-l-sky-700 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm">
                    <Badge>{item.taskReference}</Badge>
                    <span className="font-semibold text-zinc-900">{item.taskTitle}</span>
                  </p>
                  <p className="mt-1 text-xs text-zinc-600">Assigned to {item.currentAssigneeName} · assignment {item.currentAssignmentRevision}</p>
                </div>
                <div className="min-w-0 sm:text-right">
                  <p className="text-sm font-medium text-zinc-900">{item.entryType === "acknowledgement" ? "Acknowledged" : item.entryType === "progress" ? `Progress · ${item.progressState}` : item.entryType === "request" ? item.requestType === "supervisor-review" ? item.completionDeclaration ? "Work report sent for Supervisor review" : "Supervisor review requested" : `Request · ${item.requestType}` : item.entryType === "review-response" ? "Supervisor response" : "Comment"}</p>
                  {item.entryType === "review-response" && item.responseToNote && <p className="mt-1 text-xs text-zinc-600">Reply to {item.responseToActorName ?? "worker"}: {item.responseToNote}</p>}
                  <p className="mt-1 break-words text-sm text-zinc-700">{item.note}</p>
                  {item.completionDeclaration && <div className="mt-2 space-y-1 rounded-md border border-amber-200 bg-amber-50 p-3 text-left text-sm text-zinc-800">
                    <p><strong>Actions:</strong> {item.completionDeclaration.actionsSummary}</p>
                    <p><strong>Checks and results:</strong> {item.completionDeclaration.checksSummary}</p>
                    <p><strong>Reported outcome:</strong> {item.completionDeclaration.outcome === "reported-complete" ? "Worker reports complete" : item.completionDeclaration.outcome === "reported-incomplete" ? "Worker reports work remains" : "Worker reports blocked"}</p>
                    <p><strong>Remaining work:</strong> {item.completionDeclaration.remainingWork}</p>
                    <p className="text-xs text-amber-950">Bound to {item.declarationWorkEntryIds?.length ?? 0} work entries from this assignment. This is not a sign-off.</p>
                  </div>}
                  <p className="mt-1 text-xs text-zinc-500">{item.actorName} · {dateTime(item.createdAt, site.timeZone)}</p>
                  {item.entryType === "request" && item.requestType === "supervisor-review" && updates.data.canRespond
                    && <SupervisorReviewReply siteId={siteId} workOrderId={workOrderId} planRevisionId={updates.data.planRevisionId} item={item} />}
                </div>
              </li>
            ))}
          </ol>
          {pagination && pagination.totalPages > 1 && (
            <nav className="mt-3 flex flex-wrap items-center justify-between gap-3" aria-label="Team task update pages">
              <Button variant="secondary" disabled={pagination.page <= 1 || updates.isFetching} onClick={() => setPage(current => Math.max(1, current - 1))}>
                <ChevronLeft className="size-4" aria-hidden="true" /> Previous
              </Button>
              <span className="text-sm text-zinc-600">Page {pagination.page} of {pagination.totalPages}</span>
              <Button variant="secondary" disabled={pagination.page >= pagination.totalPages || updates.isFetching} onClick={() => setPage(current => current + 1)}>
                Next <ChevronRight className="size-4" aria-hidden="true" />
              </Button>
            </nav>
          )}
          {updates.data.responseBlockReason === "authority-required" && updates.data.items.some(item => item.entryType === "request" && item.requestType === "supervisor-review" && !item.hasSupervisorResponse)
            && <p role="status" className="mt-3 text-xs text-zinc-600">A current permission is required to reply to a review request.</p>}
        </>
      )}
    </section>
  );
}

export function TaskAllocations({ siteId, workOrderId, workOrderVersion }: Props) {
  const online = useOnline();
  const client = useQueryClient();
  const notify = useToast();
  const attempt = useRef<CommandAttempt | null>(null);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const path = taskAllocationsPath(siteId, workOrderId);
  const query = useQuery({
    queryKey: ["task-allocations", siteId, workOrderId, workOrderVersion],
    queryFn: () => request(path, taskAllocationsSchema),
    enabled: online,
    retry: false,
    placeholderData: (previousData) => previousData,
  });

  useEffect(() => setSelected({}), [workOrderVersion]);
  const changes = useMemo(() => (query.data?.tasks ?? [])
    .filter((task) => selected[task.taskId] && selected[task.taskId] !== (task.assigneeId ?? ""))
    .map((task) => ({ taskId: task.taskId, staffUserId: selected[task.taskId]! })), [query.data, selected]);

  const mutation = useMutation({
    mutationFn: () => {
      if (!query.data?.planRevisionId) throw new ApiError("A current work plan is required.", 409, "current_plan_required");
      const body = {
        expectedVersion: query.data.workOrderVersion,
        planRevisionId: query.data.planRevisionId,
        assignments: changes,
      };
      const content = JSON.stringify(body);
      if (!attempt.current || attempt.current.content !== content)
        attempt.current = { id: crypto.randomUUID(), content, body };
      return request(path, taskAllocationResultSchema, {
        method: "POST",
        commandId: attempt.current.id,
        body: attempt.current.body,
      });
    },
    onSuccess: () => {
      attempt.current = null;
      notify("Task assignments saved.");
      void client.invalidateQueries({ queryKey: ["task-allocations", siteId, workOrderId] });
      void client.invalidateQueries({ queryKey: ["work-order", siteId, workOrderId] });
      void client.invalidateQueries({ queryKey: ["work-orders", siteId] });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) {
        attempt.current = null;
        void client.invalidateQueries({ queryKey: ["task-allocations", siteId, workOrderId] });
        void client.invalidateQueries({ queryKey: ["work-order", siteId, workOrderId] });
      }
    },
  });

  const pageChanged = Boolean(query.data && query.data.workOrderVersion !== workOrderVersion);
  const canAssign = Boolean(query.data?.canAssign);
  const activityAudience = query.data?.activityAudience;
  return (
    <section className="panel mb-6" aria-labelledby="task-allocations-title">
      <div className="panel-heading">
        <div>
          <h2 id="task-allocations-title" tabIndex={-1} className="section-title scroll-mt-24">{canAssign ? "Assign tasks to your team" : "Tasks in the current work plan"}</h2>
          <p className="mt-1 text-sm text-zinc-600">
            {canAssign
              ? "Assign each task to an active team member who reports directly to you. Assignment does not authorize repairs or sign-off."
              : activityAudience === "supervisor"
                ? "Review the tasks assigned to your team and their progress."
                : activityAudience
                ? "Review the planned tasks and progress. The current Supervisor manages team assignments."
                : "Review the tasks included in the current work plan."}
          </p>
        </div>
        {query.data?.planRevisionNumber && <Badge>Work plan version {query.data.planRevisionNumber}</Badge>}
      </div>

      {!online && !query.data ? (
        <p className="p-5 text-sm text-amber-800" role="status">Connect to the service centre network to load the current team and assignments.</p>
      ) : query.isPending ? (
        <div className="p-5"><Loading label="Loading the current work plan and team" /></div>
      ) : query.isError ? (
        <div className="p-5"><Failure error={query.error} retry={() => { void query.refetch(); }} /></div>
      ) : query.data ? (
        <div className="space-y-4 p-5">
          {!online && <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="status">You are offline. These assignments are read-only until the connection returns.</p>}
          {pageChanged && <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="alert">This job changed after the assignments loaded. Refresh the job before saving.</p>}
          {!canAssign && query.data.blockReason && activityAudience !== "team-lead" && activityAudience !== "head-service-centre" && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="status">{blockMessages[query.data.blockReason]}</p>
          )}
          {canAssign && query.data.assignees.length > 0 && (
            <section aria-labelledby="task-team-workload-title" className="rounded-lg border border-zinc-200 bg-white p-4">
              <h3 id="task-team-workload-title" className="text-sm font-semibold text-zinc-900">Team workload</h3>
              <p className="mt-1 text-xs leading-5 text-zinc-600">Task counts come from current handed-over plans. Blocked and waiting counts show the latest progress report for each current assignment and update when this view refreshes. These figures do not show availability or authorize work.</p>
              <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                {query.data.assignees.map(person => (
                  <li key={person.placementId} className="flex min-w-0 items-center justify-between gap-3 rounded-md bg-zinc-50 px-3 py-2 text-sm">
                    <span className="truncate font-medium text-zinc-800">{person.displayName}</span>
                    <span className="shrink-0 text-right tabular-nums text-zinc-600">
                      <span className="block">{person.currentPlanTaskCount} {person.currentPlanTaskCount === 1 ? "task" : "tasks"} assigned</span>
                      <span className="block text-xs">Last reported: {person.lastReportedBlockedTaskCount} blocked · {person.lastReportedWaitingTaskCount} waiting</span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {query.data.tasks.length === 0 ? (
            <p className="py-4 text-sm text-zinc-600">No tasks are included in the current handed-over plan.</p>
          ) : (
            <div className="space-y-3">
              {query.data.tasks.map((task, index) => (
                <div
                  key={task.taskId}
                  id={`task-allocation-${task.taskId}`}
                  tabIndex={-1}
                  className={`scroll-mt-24 grid min-w-0 gap-3 rounded-xl border border-zinc-200 border-l-4 border-l-blue-500 bg-zinc-50/70 p-4 focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-blue-700 ${canAssign ? "sm:grid-cols-[minmax(0,1fr)_minmax(12rem,0.8fr)] sm:items-center" : ""}`}
                >
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{task.reference}</p>
                    <h3 className="mt-1 break-words text-sm font-semibold text-zinc-900">{task.title}</h3>
                    {canAssign && task.assigneeName && <p className="mt-1 text-xs text-zinc-600">Currently assigned to {task.assigneeName}</p>}
                  </div>
                  {canAssign ? (
                    <label className="grid min-w-0 gap-1 text-sm font-medium text-zinc-700">
                      <span>Team member</span>
                      <select
                        className="field w-full min-w-0"
                        value={selected[task.taskId] ?? task.assigneeId ?? ""}
                        disabled={!online || pageChanged || mutation.isPending || query.data.assignees.length === 0}
                        aria-label={`Assigned team member for task ${index + 1}: ${task.reference} — ${task.title}`}
                        onChange={(event) => setSelected((current) => ({ ...current, [task.taskId]: event.target.value }))}
                      >
                        {task.assigneeId ? (
                          <option value={task.assigneeId}>{task.assigneeName ?? "Current team member"} · currently assigned</option>
                        ) : (
                          <option value="">Not assigned</option>
                        )}
                        {query.data.assignees.map((person) => (
                          <option key={person.placementId} value={person.staffUserId}>{person.displayName} · {person.currentPlanTaskCount} {person.currentPlanTaskCount === 1 ? "task" : "tasks"} assigned · {person.lastReportedBlockedTaskCount} last reported blocked</option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <p className="text-sm text-zinc-600">{task.assigneeName ? `Assigned to ${task.assigneeName}` : "No team member assigned yet."}</p>
                  )}
                </div>
              ))}
            </div>
          )}
          {query.data.canAssign && query.data.assignees.length > 0 && query.data.tasks.length > 0 && (
            <div className="space-y-3 border-t border-zinc-200 pt-4">
              <FormError error={mutation.error} />
              <p className="text-xs leading-5 text-zinc-600" id="task-allocation-help">
                Only active team members who report directly to this Supervisor can be selected. Assigning work does not confirm training, procedure access or permission to begin repairs.
              </p>
              <Button
                type="button"
                disabled={!online || pageChanged || mutation.isPending || changes.length === 0}
                aria-describedby="task-allocation-help"
                onClick={() => mutation.mutate()}
              >
                {mutation.isPending ? "Saving assignments…" : "Save task assignments"}
              </Button>
            </div>
          )}
          {query.data.activityAudience && <SupervisorTaskActivity
            siteId={siteId}
            workOrderId={workOrderId}
            audience={query.data.activityAudience}
          />}
        </div>
      ) : null}
    </section>
  );
}
