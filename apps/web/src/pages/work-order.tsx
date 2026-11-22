import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { z } from "zod";
import {
  ArrowDown,
  ArrowUp,
  AlertTriangle,
  ChevronRight,
  Circle,
  Clock3,
  FileText,
  MessageSquarePlus,
  Plus,
  RefreshCw,
  ShieldAlert,
  Stethoscope,
  Wrench,
  X,
} from "lucide-react";
import { ApiError, detailSchema, diagnosticObservationSchema, eligibleSupervisorsPath, eligibleSupervisorsSchema, eligibleTeamLeadsPath, eligibleTeamLeadsSchema, operationsReviewResultSchema, orderPath, request, workPlanResultSchema } from "../api";
import type { DiagnosticObservation, WorkOrder } from "../api";
import { BackToQueue, useStaff } from "../workspace";
import { WorkOrderEvidence } from "../work-order-evidence";
import { WorkOrderScopeProposals } from "../work-order-scope-proposals";
import { IntakeFacts } from "../intake-facts";
import { TaskAllocations } from "../task-allocations";
import { SourceReportCapture } from "../source-report-capture";
import { WorkOrderChecklists } from "../work-order-checklists";
import { WorkOrderCloseoutPath } from "../work-order-closeout-path";
import { WorkOrderCompletionReadiness } from "../work-order-completion-readiness";
import { workOrderWorkflowSectionTarget } from "../work-order-workflow-navigation";
import {
  Badge,
  Button,
  Empty,
  Failure,
  FormError,
  Loading,
  PageHeading,
  dateTime,
  useOnline,
  useToast,
} from "../ui";

function fieldErrorMessage(error: unknown, path: string | string[]): string | undefined {
  if (!(error instanceof ApiError)) return undefined;
  const paths = Array.isArray(path) ? path : [path];
  const normalizedPaths = paths.map(value => value.replace(/\.\d+\./, "."));
  const entry = Object.entries(error.fields).find(([key]) =>
    paths.includes(key) ||
    (paths.includes("observations") && key.startsWith("observations.")) ||
    normalizedPaths.some(value => value.startsWith("observations.") && value === key.replace(/\.\d+\./, ".")),
  );
  if (!entry) return undefined;
  return Array.isArray(entry[1]) ? entry[1].join(" ") : entry[1];
}

function fieldErrorProps(error: unknown, path: string | string[], id: string) {
  const message = fieldErrorMessage(error, path);
  return {
    "aria-invalid": message ? true as const : undefined,
    "aria-describedby": message ? `${id}-error` : undefined,
  };
}

function FieldErrorMessage({ error, path, id }: { error: unknown; path: string | string[]; id: string }) {
  const message = fieldErrorMessage(error, path);
  return message ? <p id={`${id}-error`} className="mt-1 text-sm font-normal text-red-800">{message}</p> : null;
}

export function WorkOrderDetail() {
  const { site } = useStaff();
  const { orderId } = useParams();
  const detail = useQuery({
    queryKey: ["work-order", site.id, orderId],
    queryFn: () => request(orderPath(site.id, orderId ?? ""), detailSchema),
    enabled: Boolean(orderId),
    refetchInterval: (query) =>
      query.state.data?.evidence.some(
        (item) => item.state === "pending" || item.state === "quarantined",
      )
        ? 3000
        : false,
  });
  return (
    <>
      <BackToQueue />
      {detail.isPending ? (
        <Loading label="Loading job" />
      ) : detail.isError ? (
        <Failure
          error={detail.error}
          retry={() => {
            void detail.refetch();
          }}
        />
      ) : (
        <>
          <RelatedRequests orderId={detail.data.id} />
          <Order
            order={detail.data}
            refresh={() => {
              void detail.refetch();
            }}
          />
        </>
      )}
    </>
  );
}

const workflowStageLabels: Record<WorkOrder["workflowContext"]["stage"], string> = {
  "operations-review": "Operations review",
  "team-lead-assignment": "Team-lead assignment",
  "team-lead-work-plan": "Team lead work plan",
  "supervisor-handoff": "Supervisor handover",
  "supervisor-task-work": "Task assignment and progress",
};
const serviceKindLabels: Record<WorkOrder["serviceKind"], string> = {
  "repair-maintenance": "Repair or maintenance",
  "routine-maintenance": "Routine maintenance",
  psai: "Post-shipping acceptance inspection",
  "service-centre-pdi": "Service Centre pre-delivery inspection",
};
const serviceSourceLabels: Record<WorkOrder["serviceSource"], string> = {
  "showroom-stock": "Showroom stock",
  "partner-garage": "Partner garage",
  other: "Other source",
  unknown: "Not known yet",
};
const workflowNextActionLabels: Record<WorkOrder["workflowContext"]["nextAction"], string> = {
  "review-job": "Review the job before assigning a team lead.",
  "assign-team-lead": "Assign a qualified team lead.",
  "prepare-work-plan": "Prepare the work plan.",
  "assign-supervisor": "Assign a qualified supervisor.",
  "manage-task-work": "Assign tasks and record work progress.",
};
const workflowRoleLabels: Record<WorkOrder["workflowContext"]["responsibility"]["role"], string> = {
  operations: "Operations",
  "team-lead": "Team lead",
  supervisor: "Supervisor",
};
const workflowBlockMessages: Record<Exclude<WorkOrder["workflowContext"]["blockReason"], null>, string> = {
  "operations-review-authority-required": "Your account does not have current Operations review permission.",
  "assigned-lead-required": "Assign a team lead before preparing the work plan.",
  "operations-review-required": "Operations must review the latest version before work can be planned.",
  "site-write-required": "This account has read-only access at this site.",
  "authority-required": "The assigned team lead needs current permission to prepare this work plan.",
  "qualification-required": "A current qualification is required before this work plan can be saved.",
  "planned-tasks-required": "Add at least one task to the work plan.",
};

function WorkOrderWorkflowContext({ context }: { context: WorkOrder["workflowContext"] }) {
  const { site } = useStaff();
  const responsibility = context.responsibility.name
    ? `${workflowRoleLabels[context.responsibility.role]} · ${context.responsibility.name}`
    : `${workflowRoleLabels[context.responsibility.role]} queue`;
  return (
    <section className="panel mb-6 border-l-4 border-l-zinc-500" aria-labelledby="workflow-context-title">
      <div className="panel-heading">
        <div>
          <h2 id="workflow-context-title" className="section-title">Current job step</h2>
          <p className="mt-1 text-sm text-zinc-600">The assignment details below show who has each part of the work.</p>
        </div>
        <Badge>{workflowStageLabels[context.stage]}</Badge>
      </div>
      <div className="space-y-4 p-5 sm:p-6">
        <dl className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="min-w-0">
            <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Responsible</dt>
            <dd className="mt-1 break-words text-sm font-medium text-zinc-900">{responsibility}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Next step</dt>
            <dd className="mt-1 break-words text-sm text-zinc-900">{workflowNextActionLabels[context.nextAction]}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Due time</dt>
            <dd className="mt-1 text-sm text-zinc-900">{context.dueAt ? dateTime(context.dueAt, site.timeZone) : "No due time recorded"}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Evidence checklist</dt>
            <dd className="mt-1 text-sm text-zinc-900">{context.evidenceChecklist === "awaiting-approved-sop" ? "Not configured; approved SOPs are needed." : "Available"}</dd>
          </div>
        </dl>
        {context.actionReadiness === "blocked" && context.blockReason && (
          <p className="border-l-2 border-l-amber-600 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950">
            {workflowBlockMessages[context.blockReason]}
          </p>
        )}
        {context.actionReadiness === "available" && (
          <p className="text-sm leading-6 text-zinc-600">This step is available to your account. The server checks permission again when you save.</p>
        )}
        <Link
          className="inline-flex min-h-11 items-center rounded font-semibold text-blue-800 underline decoration-blue-300 underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
          to={`#${workOrderWorkflowSectionTarget(context.nextAction)}`}
          onClick={(event) => {
            event.preventDefault();
            const targetId = workOrderWorkflowSectionTarget(context.nextAction);
            const target = document.getElementById(targetId);
            if (!target) return;
            window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#${targetId}`);
            target.focus({ preventScroll: true });
            const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
            const workspace = target.closest<HTMLElement>(".workspace-content");
            if (workspace && getComputedStyle(workspace).overflowY !== "visible") {
              const workspaceBounds = workspace.getBoundingClientRect();
              const stickyHeader = workspace.querySelector<HTMLElement>(":scope > header");
              const headerBottom = stickyHeader?.getBoundingClientRect().bottom ?? workspaceBounds.top;
              const visibleTop = Math.max(workspaceBounds.top, headerBottom) + 12;
              const visibleBottom = workspaceBounds.bottom - 12;
              const targetBounds = target.getBoundingClientRect();
              const topDelta = targetBounds.top - visibleTop;
              const bottomDelta = targetBounds.bottom - visibleBottom;
              const delta = topDelta < 0 ? topDelta : bottomDelta > 0 ? bottomDelta : 0;
              if (delta !== 0) workspace.scrollBy({ top: delta, behavior });
            } else {
              target.scrollIntoView({ behavior, block: "start" });
            }
          }}
        >
          Go to the {workflowStageLabels[context.stage]} section
        </Link>
        {context.stage === "supervisor-task-work" && (
          <p role="note" className="border-l-4 border-amber-500 bg-amber-50/60 px-3 py-2 text-sm leading-6 text-amber-950">
            Record task progress, requests and evidence here. This step cannot sign off technical completion or release the vehicle; those sign-off steps are not configured yet.
          </p>
        )}
      </div>
    </section>
  );
}

const relatedRequestsSchema=z.object({items:z.array(z.object({id:z.string().uuid(),concern:z.string(),sourceChannel:z.string(),createdAt:z.string()})),page:z.number(),totalPages:z.number()});
const relatedRequestContactsSchema=z.object({items:z.array(z.object({id:z.string().uuid(),recordedAt:z.string(),recordedByName:z.string().nullable(),channel:z.string(),outcome:z.enum(['reached','no-answer','callback-requested','other']),notes:z.string(),isCorrected:z.boolean()})),page:z.number(),totalPages:z.number()});
const contactOutcomeLabels={reached:'Reached', 'no-answer':'No answer', 'callback-requested':'Callback requested', other:'Other'} as const;
function RelatedRequests({orderId}:{orderId:string}) {
  const {site}=useStaff(),[page,setPage]=useState(1);
  const related=useQuery({queryKey:['job-requests',site.id,orderId,page],queryFn:()=>request(`${orderPath(site.id,orderId)}/service-requests?page=${page}`,relatedRequestsSchema)});
  const canViewCustomerUpdates=site.roleCodes.some(role=>role==='head-service-centre'||role==='service-advisor');
  return <section className="panel mb-4 p-5" aria-labelledby="related-requests-title"><h2 id="related-requests-title" className="section-title">Related requests</h2>
    {related.isPending?<Loading label="Loading related requests"/>:related.isError?<Failure error={related.error} retry={()=>void related.refetch()}/>:related.data.items.length===0?<p className="mt-3 text-sm text-zinc-600">No related requests are available to you.</p>:<><ul className="mt-3 divide-y divide-zinc-200">{related.data.items.map(item=><RelatedRequestItem key={item.id} item={item} siteId={site.id} timeZone={site.timeZone} canViewCustomerUpdates={canViewCustomerUpdates}/>)}</ul><div className="flex items-center gap-3"><Button variant="secondary" disabled={page<=1} onClick={()=>setPage(page-1)}>Previous</Button><span>Page {page} of {Math.max(1,related.data.totalPages)}</span><Button variant="secondary" disabled={page>=related.data.totalPages} onClick={()=>setPage(page+1)}>Next</Button></div></>}
  </section>;
}

function RelatedRequestItem({item,siteId,timeZone,canViewCustomerUpdates}:{item:z.infer<typeof relatedRequestsSchema>['items'][number];siteId:string;timeZone:string;canViewCustomerUpdates:boolean}) {
  const [showHistory,setShowHistory]=useState(false);
  const contacts=useQuery({queryKey:['request-contacts',siteId,item.id,1],queryFn:()=>request(`/sites/${siteId}/service-requests/${item.id}/contacts?page=1&pageSize=3`,relatedRequestContactsSchema),enabled:showHistory&&canViewCustomerUpdates});
  return <li className="py-3">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Link className="font-semibold text-blue-700 underline" to={`/sites/${siteId}/requests?request=${item.id}`}>{canViewCustomerUpdates?'Open request to record customer contact':'View request'}</Link>
      {canViewCustomerUpdates&&<Button type="button" variant="secondary" aria-expanded={showHistory} onClick={()=>setShowHistory(value=>!value)}>{showHistory?'Hide contact history':'View contact history'}</Button>}
    </div>
    <p className="mt-2 break-words">{item.concern}</p><p className="text-sm text-zinc-600">{item.sourceChannel} · {dateTime(item.createdAt,timeZone)}</p>
    {showHistory&&<div className="mt-3 rounded-lg border-l-2 border-blue-700 bg-blue-50/60 p-3" aria-label="Customer contact history">
      {contacts.isPending?<Loading label="Loading contact history"/>:contacts.isError?<Failure error={contacts.error} retry={()=>void contacts.refetch()}/>:contacts.data.items.length===0?<p className="text-sm text-zinc-700">No customer contact has been recorded yet.</p>:<>
        <h3 className="text-sm font-semibold text-zinc-900">Recent customer contact</h3>
        <ol className="mt-2 space-y-3">{contacts.data.items.map(entry=><li key={entry.id} className="border-t border-blue-100 pt-2 text-sm">
          <p className="font-medium text-zinc-900">{contactOutcomeLabels[entry.outcome]} by {entry.recordedByName??'staff member'} · {dateTime(entry.recordedAt,timeZone)} · {entry.channel}</p>
          <p className="mt-1 whitespace-pre-wrap break-words text-zinc-700">{entry.notes}</p>
          {entry.isCorrected&&<p className="mt-1 text-xs font-medium text-amber-800">This entry has a correction in the request history.</p>}
        </li>)}</ol>
        {contacts.data.totalPages>1&&<p className="mt-2 text-xs text-zinc-600">Showing the latest 3 entries. Open the request to view the full history.</p>}
      </>}
    </div>}
  </li>;
}

type CommandAttempt = {
  id: string;
  content: string;
  body: Record<string, unknown>;
};

function useOrderCommand(
  order: WorkOrder,
  command: string,
  onSaved: () => void,
) {
  const { site } = useStaff();
  const client = useQueryClient();
  const notify = useToast();
  const attempt = useRef<CommandAttempt | null>(null);
  const mutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => {
      const content = JSON.stringify(body);
      if (!attempt.current || attempt.current.content !== content)
        attempt.current = {
          id: crypto.randomUUID(),
          content,
          body: { ...body, expectedVersion: order.version },
        };
      return request(
        `${orderPath(site.id, order.id)}/${command}`,
        detailSchema,
        {
          method: "POST",
          commandId: attempt.current.id,
          body: attempt.current.body,
        },
      );
    },
    onSuccess: (updated) => {
      attempt.current = null;
      client.setQueryData(["work-order", site.id, order.id], updated);
      void client.invalidateQueries({ queryKey: ["work-orders", site.id] });
      notify("Job update saved.");
      onSaved();
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409)
        attempt.current = null;
    },
  });
  return mutation;
}

function Order({ order, refresh }: { order: WorkOrder; refresh: () => void }) {
  const { session, site } = useStaff();
  const online = useOnline();
  const [panel, setPanel] = useState<"complaint" | "task" | "hold" | "diagnostic" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  function closePanel() {
    const closing = panel;
    setPanel(null);
    if (closing) window.requestAnimationFrame(() => document.getElementById(`open-${closing}-form`)?.focus());
  }
  const completed = () => {
    closePanel();
    setNotice("Saved to this job's record.");
  };
  function toggle(next: typeof panel) {
    setPanel((current) => (current === next ? null : next));
    setNotice(null);
  }
  const actionsDisabled = !online;
  return (
    <>
      <PageHeading
        eyebrow={`Work order · version ${order.version}`}
        title={order.reference}
        action={
          <div className="flex items-center gap-2">
            <Link
              className="button button-secondary"
              to={`/sites/${site.id}/work-orders/${order.id}/print`}
              aria-label="Print service report"
            >
              <FileText className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">Print service report</span>
            </Link>
            <Button
              variant="secondary"
              onClick={refresh}
              aria-label="Refresh work order"
            >
              <RefreshCw className="size-4" aria-hidden="true" />
            </Button>
          </div>
        }
      >
        <span>{serviceKindLabels[order.serviceKind]}</span><span className="mx-2 text-zinc-300">·</span>{order.vehicleLabel} <span className="mx-1 text-zinc-300">/</span>{" "}
        {order.registration || "Registration not recorded"}
        {order.serviceKind === "service-centre-pdi" && <span className="ml-2 text-sm font-normal text-zinc-600">· Reported source: {serviceSourceLabels[order.serviceSource]}</span>}
        {order.serviceKind === "psai" && order.shippingReference && <span className="ml-2 text-sm font-normal text-zinc-600">· Shipment ref: {order.shippingReference}</span>}
      </PageHeading>
      {notice && (
        <p
          role="status"
          className="mb-5 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900"
        >
          {notice}
        </p>
      )}
      <WorkOrderWorkflowContext context={order.workflowContext} />
      <WorkOrderCloseoutPath stages={order.closeoutPath} />
      <WorkOrderCompletionReadiness
        readiness={order.completionReadiness}
        siteId={site.id}
        workOrderId={order.id}
        canOpenTaskAssignments={Boolean(order.completionReadiness.currentSupervisorHandoff && (
          site.roleCodes.includes("head-service-centre")
          || order.teamLeadAssignment?.leadUserId === session.user.id
          || order.supervisorHandoff?.supervisorUserId === session.user.id
        ))}
      />
      <WorkOrderChecklists order={order} siteId={site.id} canWrite={site.canWrite} />
      <WorkOrderScopeProposals order={order} refresh={refresh} />
      <SourceReportCapture order={order} refresh={refresh} />
      <OperationsReview order={order} refresh={refresh} />
      <OperationsAssignment order={order} refresh={refresh} />
      {order.teamLeadAssignment && <TeamLeadWorkPlan order={order} refresh={refresh} />}
      <SupervisorHandoff order={order} refresh={refresh} />
      {order.supervisorHandoff && <TaskAllocations siteId={site.id} workOrderId={order.id} workOrderVersion={order.version} />}
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="min-w-0 space-y-6 xl:col-span-2">
          <section className="panel" aria-labelledby="visit-title">
            <div className="panel-heading">
              <h2 id="visit-title" className="section-title">
                Visit record
              </h2>
              <span className="text-xs text-zinc-500">
                Opened {dateTime(order.createdAt, site.timeZone)}
              </span>
            </div>
            <dl className="grid gap-6 p-5 sm:grid-cols-2 sm:p-6">
                <div>
                  <dt className="text-xs text-zinc-500">Paying client</dt>
                  <dd className="mt-1.5 text-sm font-semibold">{order.client?.name ?? "Not recorded"}</dd>
                  {order.client?.phone && <dd className="mt-1 text-sm text-zinc-500">{order.client.phone}</dd>}
                  {order.client?.email && <dd className="mt-1 break-all text-sm text-zinc-500">{order.client.email}</dd>}
                </div>
                <div>
                  <dt className="text-xs text-zinc-500">Reported vehicle owner</dt>
                  <dd className="mt-1.5 text-sm font-semibold">{order.owner?.name ?? "Not recorded"}</dd>
                  {order.owner && <dd className="mt-1 text-xs text-amber-700">{order.owner.state === "reported" ? "Reported · not verified" : order.owner.state}</dd>}
                </div>
                <div>
                  <dt className="text-xs text-zinc-500">Visit contact</dt>
                  <dd className="mt-1.5 text-sm font-semibold">{order.visitContact?.name ?? "Not recorded"}</dd>
                  {order.visitContact?.phone && <dd className="mt-1 text-sm text-zinc-500">{order.visitContact.phone}</dd>}
                  {order.visitContact?.email && <dd className="mt-1 break-all text-sm text-zinc-500">{order.visitContact.email}</dd>}
                </div>
              <div>
                <dt className="text-xs text-zinc-500">
                  Vehicle identification number
                </dt>
                <dd className="mt-1.5 break-all font-mono text-sm tabular-nums">
                  {order.vehicle.vin}
                </dd>
                <dd className="mt-2 text-sm text-zinc-700">
                  {order.vehicle.make} {order.vehicle.model}
                  {order.vehicle.variant ? ` · ${order.vehicle.variant}` : ""}
                </dd>
                {order.vehicle.powertrain && (
                  <dd className="mt-1 text-xs text-zinc-500">
                    {order.vehicle.powertrain}
                  </dd>
                )}
                <dd className="mt-1 text-xs text-zinc-500">
                  {order.vehicle.registration || "Registration not recorded"}
                </dd>
                <dd className="mt-3 text-xs text-zinc-500">
                  {order.odometerKm.toLocaleString("en-GH")} km{" "}
                  <span className="mx-2 text-zinc-300">·</span>{" "}
                  {order.socPercent === null
                    ? "Battery charge not recorded"
                    : `${order.socPercent}% charge`}
                </dd>
              </div>
            </dl>
            <div className="border-t border-zinc-100 px-5 py-5 sm:px-6">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-zinc-900">
                  Service history at this site
                </h3>
                <Badge>{order.vehicleHistory.length} visits</Badge>
              </div>
              <ol className="space-y-3">
                {order.vehicleHistory.map((visit) => (
                  <li
                    key={visit.id}
                    className="rounded-lg border border-zinc-200 p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-zinc-900">
                        {visit.reference}
                        {visit.id === order.id && (
                          <span className="ml-2 align-middle">
                            <Badge>Current visit</Badge>
                          </span>
                        )}
                      </p>
                      <time dateTime={visit.openedAt} className="text-xs text-zinc-500">
                        {dateTime(visit.openedAt, site.timeZone)}
                      </time>
                    </div>
                    {(visit.clientName || visit.reportedOwnerName) && <p className="mt-2 text-xs leading-5 text-zinc-600">{visit.clientName && <>Payer: {visit.clientName}</>}{visit.clientName && visit.reportedOwnerName && <span className="mx-2 text-zinc-300">·</span>}{visit.reportedOwnerName && <>Reported owner: {visit.reportedOwnerName}</>}</p>}
                    <p className="mt-2 text-xs text-zinc-600">
                      {visit.registration || "Registration not recorded"} · {visit.odometerKm.toLocaleString("en-GH")} km
                      {visit.socPercent === null ? "" : ` · ${visit.socPercent}% charge`}
                    </p>
                    {visit.complaints.length > 0 && (
                      <ul className="mt-3 space-y-1 border-l-2 border-zinc-200 pl-3">
                        {visit.complaints.map((complaint) => (
                          <li
                            key={`${visit.id}-${complaint.reference}`}
                            className="break-words text-xs leading-5 text-zinc-700"
                          >
                            <span className="font-mono text-zinc-500">
                              {complaint.reference}
                            </span>{" "}
                            {complaint.wording}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          </section>
          <WorkOrderEvidence order={order} refresh={refresh} />
          <IntakeFacts order={order} refresh={refresh} />
          <section className="panel" aria-labelledby="complaints-title">
            <div className="panel-heading">
              <div className="flex items-center gap-3">
                <MessageSquarePlus
                  className="size-4 text-zinc-500"
                  aria-hidden="true"
                />
                <h2 id="complaints-title" className="section-title">
                  Customer concerns
                </h2>
                <Badge>{order.complaints.length}</Badge>
              </div>
              {site.canWrite && (
                <Button
                  variant="secondary"
                  id="open-complaint-form"
                  onClick={() => toggle("complaint")}
                  aria-expanded={panel === "complaint"}
                  aria-controls="complaint-form"
                  disabled={actionsDisabled}
                >
                  <Plus className="size-4" aria-hidden="true" />
                  Add concern
                </Button>
              )}
            </div>
            <ol className="divide-y divide-zinc-100">
              {order.complaints.map((complaint) => (
                <li
                  className="flex items-start gap-4 px-5 py-5 sm:px-6"
                  key={complaint.id}
                >
                  <span className="mt-0.5 rounded bg-zinc-100 px-2 py-1 font-mono text-xs font-semibold tabular-nums text-zinc-600">
                    {complaint.reference}
                  </span>
                  <p className="min-w-0 whitespace-pre-wrap break-words text-sm leading-6 text-zinc-700">
                    {complaint.wording}
                  </p>
                </li>
              ))}
            </ol>
            {panel === "complaint" && (
              <ComplaintForm
                order={order}
                onSaved={completed}
                onClose={closePanel}
              />
            )}
          </section>
          <section className="panel" aria-labelledby="tasks-title">
            <div className="panel-heading">
              <div className="flex items-center gap-3">
                <Wrench className="size-4 text-zinc-500" aria-hidden="true" />
                <h2 id="tasks-title" className="section-title">
                  Planned tasks
                </h2>
                <Badge>{order.tasks.length}</Badge>
              </div>
              {site.canWrite && (
                <Button
                  variant="secondary"
                  id="open-task-form"
                  onClick={() => toggle("task")}
                  aria-expanded={panel === "task"}
                  aria-controls="task-form"
                  disabled={actionsDisabled || order.complaints.length === 0}
                >
                  <Plus className="size-4" aria-hidden="true" />
                  Plan task
                </Button>
              )}
            </div>
            {order.tasks.length === 0 ? (
              <div className="px-6 py-7 text-sm leading-6 text-zinc-500">
                No tasks planned. Link each proposed task to a customer concern
                before its scope is reviewed.
              </div>
            ) : (
              <ul className="divide-y divide-zinc-100">
                {order.tasks.map((task) => {
                  const holds = order.holds.filter(
                    (hold) => hold.taskId === task.id,
                  );
                  return (
                    <li
                      key={task.id}
                      className="flex flex-wrap items-start justify-between gap-3 px-5 py-5 sm:px-6"
                    >
                      <div className="flex min-w-0 gap-4">
                        <span className="mt-0.5 h-fit rounded bg-zinc-100 px-2 py-1 font-mono text-xs font-semibold tabular-nums text-zinc-600">
                          {task.reference}
                        </span>
                        <div className="min-w-0">
                          <p className="break-words text-sm font-medium text-zinc-800">
                            {task.title}
                          </p>
                          <p className="mt-1 text-xs text-zinc-500">
                            For{" "}
                            {order.complaints.find(
                              (complaint) => complaint.id === task.complaintId,
                            )?.reference ?? "linked concern"}
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Badge>Planned</Badge>
                        {holds.length > 0 && (
                          <Badge tone="warning">
                            {holds.length} open{" "}
                            {holds.length === 1 ? "hold" : "holds"}
                          </Badge>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {panel === "task" && (
              <TaskForm
                order={order}
                onSaved={completed}
                onClose={closePanel}
              />
            )}
            <p className="border-t border-zinc-100 px-6 py-3 text-xs leading-5 text-zinc-500">
              Planning a task does not authorise work or assign a technician.
            </p>
          </section>
          <section className="panel" aria-labelledby="diagnostics-title">
            <div className="panel-heading">
              <div className="flex items-center gap-3">
                <Stethoscope className="size-4 text-zinc-500" aria-hidden="true" />
                <h2 id="diagnostics-title" className="section-title">Diagnostic findings</h2>
                <Badge>{order.diagnosticFindings.length}</Badge>
              </div>
              {site.canWrite && (
                <Button
                  variant="secondary"
                  id="open-diagnostic-form"
                  onClick={() => toggle("diagnostic")}
                  aria-expanded={panel === "diagnostic"}
                  aria-controls="diagnostic-form"
                  disabled={actionsDisabled || order.complaints.length === 0}
                >
                  <Plus className="size-4" aria-hidden="true" />
                  Record finding
                </Button>
              )}
            </div>
            {order.diagnosticFindings.length === 0 ? (
              <div className="px-6 py-7 text-sm leading-6 text-zinc-500">
                No diagnostic findings recorded. A finding records observations only; it does not authorise tests or repairs.
              </div>
            ) : (
              <ol className="divide-y divide-zinc-100">
                {order.diagnosticFindings.map((finding) => (
                  <li key={finding.id} className="space-y-3 px-5 py-5 sm:px-6">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={finding.certainty.state === "inconclusive" ? "warning" : "neutral"}>
                        {finding.certainty.state === "inconclusive" ? "Inconclusive" : "Certainty stated"}
                      </Badge>
                      <span className="text-xs text-zinc-500">
                        {order.complaints.find((item) => item.id === finding.complaintId)?.reference ?? "Concern"}
                        {finding.taskId ? ` · ${order.tasks.find((item) => item.id === finding.taskId)?.reference ?? "Task"}` : " · Whole concern"}
                      </span>
                      {finding.supersedesFindingId && <Badge tone="neutral">Correction</Badge>}
                    </div>
                    <h3 className="text-sm font-semibold text-zinc-900">{finding.summary}</h3>
                    <p className="whitespace-pre-wrap break-words text-sm leading-6 text-zinc-700">{finding.certainty.explanation}</p>
                    <ul className="space-y-2 border-l border-zinc-200 pl-4">
                      {finding.observations.map((observation, index) => (
                        <li key={`${finding.id}-${index}`} className="text-sm leading-6 text-zinc-700">{diagnosticObservationLabel(observation)}</li>
                      ))}
                    </ul>
                    <p className="text-sm leading-6 text-zinc-700"><span className="font-medium">Residual risk: </span>{finding.residualRisk}</p>
                    {finding.restrictions && <p className="text-sm leading-6 text-zinc-700"><span className="font-medium">Restrictions: </span>{finding.restrictions}</p>}
                    {finding.evidenceIds.length > 0 && (
                      <ul className="flex flex-wrap gap-2" aria-label="Attached diagnostic evidence">
                        {finding.evidenceIds.map((id) => <li key={id}><Badge>{order.evidence.find((item) => item.evidenceId === id)?.displayName ?? "Attached evidence"}</Badge></li>)}
                      </ul>
                    )}
                    <p className="text-xs text-zinc-500">Recorded by {finding.recordedBy} · observed {dateTime(finding.observedAt, site.timeZone)} · recorded {dateTime(finding.recordedAt, site.timeZone)}</p>
                  </li>
                ))}
              </ol>
            )}
            {panel === "diagnostic" && <DiagnosticForm order={order} onSaved={completed} onClose={closePanel} />}
            <p className="border-t border-zinc-100 px-6 py-3 text-xs leading-5 text-zinc-500">
              Findings and evidence are retained as entered. They do not change planned tasks, consent, repair authority, inspection or release gates.
            </p>
          </section>
          <section className="panel" aria-labelledby="holds-title">
            <div className="panel-heading">
              <div className="flex items-center gap-3">
                <ShieldAlert
                  className="size-4 text-zinc-500"
                  aria-hidden="true"
                />
                <h2 id="holds-title" className="section-title">
                  Holds
                </h2>
                <Badge>{order.openHoldCount} open</Badge>
              </div>
              {site.canWrite && (
                <Button
                  variant="secondary"
                  id="open-hold-form"
                  onClick={() => toggle("hold")}
                  aria-expanded={panel === "hold"}
                  aria-controls="hold-form"
                  disabled={actionsDisabled}
                >
                  <Plus className="size-4" aria-hidden="true" />
                  Report hold
                </Button>
              )}
            </div>
            {order.holds.length === 0 ? (
              <div className="px-6 py-7 text-sm text-zinc-500">
                No holds have been reported. This does not establish technical
                readiness.
              </div>
            ) : (
              <ul className="divide-y divide-zinc-100">
                {order.holds.map((hold) => (
                  <li key={hold.id} className="px-5 py-5 sm:px-6">
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <Badge
                        tone={hold.resolution ? "green" : hold.severity === "stop" ? "danger" : "warning"}
                      >
                        {!hold.resolution && <AlertTriangle className="size-3" aria-hidden="true" />}
                        {hold.resolution ? "Resolved" : `${hold.severity === "stop" ? "Stop" : "Warning"} · ${hold.category}`}
                      </Badge>
                      <span className="text-xs text-zinc-500">
                        {hold.taskId === null
                          ? "Whole work order"
                          : (order.tasks.find((task) => task.id === hold.taskId)
                              ?.reference ?? "Task")}
                      </span>
                    </div>
                    <p className="whitespace-pre-wrap break-words text-sm leading-6 text-zinc-800">
                      {hold.reason}
                    </p>
                    <p className="mt-2 break-words text-xs leading-5 text-zinc-500">
                      Source: {hold.source}
                    </p>
                    <p className="mt-3 text-xs text-zinc-500">
                      Owner: {hold.openedBy} · {dateTime(hold.openedAt, site.timeZone)}
                    </p>
                    {hold.resolution ? (
                      <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 p-4">
                        <p className="text-sm font-medium text-emerald-950">Resolution recorded</p>
                        <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-emerald-900">{hold.resolution.reason}</p>
                        <p className="mt-2 text-xs text-emerald-800">{hold.resolution.resolvedBy} · {dateTime(hold.resolution.resolvedAt, site.timeZone)} · {hold.resolution.evidenceIds.length} evidence item(s)</p>
                      </div>
                    ) : order.canResolveHolds ? (
                      <HoldResolutionForm order={order} holdId={hold.id} onSaved={refresh} />
                    ) : (
                      <p className="mt-3 text-xs leading-5 text-zinc-500">Resolution requires the currently assigned, qualified Team Lead and a separate active hold-resolution grant.</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {panel === "hold" && (
              <HoldForm
                order={order}
                onSaved={completed}
                onClose={closePanel}
              />
            )}
          </section>
          <section className="panel" aria-labelledby="history-title">
            <div className="panel-heading">
              <div className="flex items-center gap-3">
                <Clock3 className="size-4 text-zinc-500" aria-hidden="true" />
                <h2 id="history-title" className="section-title">
                  Record history
                </h2>
              </div>
              <span className="text-xs text-zinc-500">
                Attributable changes
              </span>
            </div>
            {order.history.length === 0 ? (
              <Empty title="No recorded events">
                Refresh the work order to retrieve its history.
              </Empty>
            ) : (
              <ol className="divide-y divide-zinc-100">
                {order.history.map((event) => (
                  <li
                    key={event.id}
                    className="flex items-start gap-4 px-5 py-4 sm:px-6"
                  >
                    <div className="mt-1.5 size-2 shrink-0 rounded-full bg-zinc-300" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-zinc-700">
                        {eventLabel(event.action)}
                      </p>
                      {event.reason && (
                        <p className="mt-1 break-words text-xs leading-5 text-zinc-500">
                          {event.reason}
                        </p>
                      )}
                      <p className="mt-1.5 text-xs text-zinc-500">
                        {event.actor} · {dateTime(event.at, site.timeZone)}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
        <aside className="space-y-5">
          <section className="panel" aria-labelledby="gates-title">
            <div className="panel-heading">
              <div>
                <h2 id="gates-title" className="section-title">
                  Process gates
                </h2>
                <p className="mt-1 text-xs text-zinc-500">
                  Independent evidence and decisions
                </p>
              </div>
            </div>
            <ol className="divide-y divide-zinc-100">
              {order.gates.map((gate) => (
                <li className="p-5" key={gate.code}>
                  <div className="flex items-center gap-3">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-zinc-200 font-mono text-xs font-semibold text-zinc-500">
                      {gate.code}
                    </span>
                    <div>
                      <h3 className="text-sm font-semibold text-zinc-800">
                        {gate.label}
                      </h3>
                      <span className="text-xs text-amber-700">
                        Evidence pending
                      </span>
                    </div>
                    <Circle
                      className="ml-auto size-4 shrink-0 text-zinc-300"
                      aria-label="Pending"
                    />
                  </div>
                  <ul className="mt-3 space-y-2">
                    {gate.missing.map((missing) => (
                      <li
                        key={missing}
                        className="flex items-start gap-2 text-xs leading-5 text-zinc-500"
                      >
                        <ChevronRight
                          className="mt-1 size-3 shrink-0 text-zinc-300"
                          aria-hidden="true"
                        />
                        <span>{missing}</span>
                      </li>
                    ))}
                  </ul>
                  {gate.code === "G2" && (
                    <p className="mt-3 text-xs leading-5 text-zinc-600">
                      Diagnostic consent allows diagnosis only. It does not authorize repair, replacement parts, or additional costs.
                    </p>
                  )}
                </li>
              ))}
            </ol>
          </section>
          <div className="rounded-xl border border-zinc-200 p-5">
            <FileText
              className="mb-3 size-5 text-zinc-500"
              aria-hidden="true"
            />
            <h2 className="text-sm font-semibold text-zinc-800">
              A draft is the starting point
            </h2>
            <p className="mt-2 text-xs leading-6 text-zinc-700">
              Record concerns, proposed tasks and holds here. Approved scope,
              technical completion, quality release and commercial closure need
              separate decisions.
            </p>
          </div>
        </aside>
      </div>
    </>
  );
}

function HoldResolutionForm({order,holdId,onSaved}:{order:WorkOrder;holdId:string;onSaved:()=>void}) {
  const [reason,setReason]=useState("");
  const [evidenceIds,setEvidenceIds]=useState<string[]>([]);
  const online=useOnline();
  const mutation=useOrderCommand(order,`holds/${holdId}/resolution`,onSaved);
  const evidence=order.evidence.filter(item=>item.state==="accepted"&&item.attachedAt);
  function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    mutation.mutate({resolution:reason.trim(),evidenceIds});
  }
  return <form className="mt-4 space-y-3 rounded-md border border-zinc-200 bg-zinc-50 p-4" onSubmit={submit}>
    <h3 className="text-sm font-semibold text-zinc-900">Record how the hold was cleared</h3>
    <div>
      <label htmlFor={`hold-resolution-${holdId}`}>What changed?</label>
      <textarea id={`hold-resolution-${holdId}`} value={reason} onChange={event=>setReason(event.target.value)} required maxLength={4000} disabled={mutation.isPending} />
      <p className="field-hint">Describe the observed correction or clearance. Do not use this to sign off inspection or release.</p>
    </div>
    {!online&&<p className="text-sm text-amber-900">Reconnect before resolving this hold. Your resolution has not been saved.</p>}
    {evidence.length===0 ? <p className="text-sm text-amber-900">Attach and scan accepted evidence to this work order before resolving the hold.</p> : <fieldset className="space-y-2">
      <legend className="text-sm font-medium text-zinc-800">Accepted evidence for this resolution</legend>
      {evidence.map(item=><label key={item.evidenceId} className="flex items-start gap-2 text-sm font-normal"><input type="checkbox" checked={evidenceIds.includes(item.evidenceId)} onChange={event=>setEvidenceIds(current=>event.target.checked?[...current,item.evidenceId]:current.filter(id=>id!==item.evidenceId))} disabled={mutation.isPending}/><span>{item.displayName}</span></label>)}
    </fieldset>}
    <FormError error={mutation.error}/>
    <Button type="submit" disabled={!online||mutation.isPending||evidenceIds.length===0}>{mutation.isPending?"Saving…":"Resolve hold"}</Button>
  </form>;
}

function OperationsReview({order,refresh}:{order:WorkOrder;refresh:()=>void}) {
  const {site}=useStaff();
  const client=useQueryClient();
  const notify=useToast();
  const online=useOnline();
  const [notes,setNotes]=useState("");
  const attempt=useRef<{id:string;content:string;body:{expectedVersion:number;notes:string}}|null>(null);
  const mutation=useMutation({
    mutationFn:(input:{notes:string})=>{
      const content=JSON.stringify(input);
      if(!attempt.current||attempt.current.content!==content)
        attempt.current={id:crypto.randomUUID(),content,body:{...input,expectedVersion:order.version}};
      return request(`${orderPath(site.id,order.id)}/operations-review`,operationsReviewResultSchema,{method:"POST",commandId:attempt.current.id,body:attempt.current.body});
    },
    onSuccess:()=>{attempt.current=null;setNotes("");notify("Operations review recorded.");void client.invalidateQueries({queryKey:["work-order",site.id,order.id]});void client.invalidateQueries({queryKey:["work-orders",site.id]});refresh();},
    onError:(error)=>{if(error instanceof ApiError&&error.status===409){attempt.current=null;refresh();}},
  });
  const review=order.operationsReview;
  const reviewNeedsRefresh=Boolean(review&&!review.isCurrent);
  return <section className="panel mb-4 border-l-4 border-l-sky-600" aria-labelledby="operations-review-title">
    <div className="panel-heading"><h2 id="operations-review-title" tabIndex={-1} className="section-title scroll-mt-24">Operations review</h2><Badge>{review?.isCurrent?"Current review":review?"Review needs refresh":"Awaiting review"}</Badge></div>
    <div className="space-y-4 p-5 sm:p-6">
      <p className="text-sm leading-6 text-zinc-600">Review the new job before assigning a qualified team lead. This review only covers team-lead routing. It does not confirm vehicle handover, approve diagnosis or repairs, or sign off technical completion.</p>
      {review&&<dl className="grid gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-4 sm:grid-cols-2"><div><dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Reviewed by</dt><dd className="mt-1 text-sm font-medium">{review.reviewedByName}</dd></div><div><dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Review date and time</dt><dd className="mt-1 text-sm">{dateTime(review.reviewedAt, site.timeZone)}</dd></div><div><dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Job version reviewed</dt><dd className="mt-1 text-sm">{review.reviewedWorkOrderVersion}</dd></div>{review.notes&&<div className="sm:col-span-2"><dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Review notes</dt><dd className="mt-1 whitespace-pre-wrap text-sm leading-6">{review.notes}</dd></div>}</dl>}
      {review?.isCurrent&&<p role="status" className="text-sm text-emerald-800">This review covers the current work-order version and is ready for team-lead assignment.</p>}
      {!order.canReviewOperations?<p className="border-t border-zinc-100 pt-4 text-sm text-zinc-600">You need current Operations permission to record or update this review.</p>:review?.isCurrent?<p className="text-sm text-zinc-600">The current review is recorded. Review the job again if it changes before team-lead assignment.</p>:<form className="grid gap-3 border-t border-zinc-100 pt-4" onSubmit={event=>{event.preventDefault();mutation.mutate({notes:notes.trim()});}}>
        {reviewNeedsRefresh&&<p className="text-sm text-amber-800">This job changed after the last review. Review it again before assigning a team lead.</p>}
        <label htmlFor="operations-review-notes">Review notes <span className="font-normal text-zinc-500">(optional)</span></label>
        <textarea id="operations-review-notes" maxLength={1000} value={notes} onChange={event=>setNotes(event.target.value)} disabled={!online||mutation.isPending} placeholder="Add routing context for the team lead." {...fieldErrorProps(mutation.error,"notes","operations-review-notes")} />
        <FieldErrorMessage error={mutation.error} path="notes" id="operations-review-notes" />
        <div><FormError error={mutation.error}/><Button type="submit" disabled={!online||mutation.isPending}>{mutation.isPending?"Recording review…":review?"Record updated review":"Record Operations review"}</Button></div>
      </form>}
      {!online&&<p role="status" className="text-sm text-amber-800">Reconnect to record an Operations review.</p>}
    </div>
  </section>;
}

function OperationsAssignment({order,refresh}:{order:WorkOrder;refresh:()=>void}) {
  const {site}=useStaff();
  const online=useOnline();
  const client=useQueryClient();
  const [leadUserId,setLeadUserId]=useState("");
  const [reason,setReason]=useState("");
  const attempt=useRef<{id:string;content:string;body:{expectedVersion:number;operationsReviewId:string;leadUserId:string;reason:string}}|null>(null);
  const eligible=useQuery({queryKey:["eligible-team-leads",site.id,order.id,order.version],queryFn:()=>request(eligibleTeamLeadsPath(site.id,order.id),eligibleTeamLeadsSchema),enabled:online,retry:false});
  const mutation=useMutation({
    mutationFn:(input:{leadUserId:string;reason:string})=>{
      const content=JSON.stringify(input);
      if(!attempt.current||attempt.current.content!==content)
        attempt.current={id:crypto.randomUUID(),content,body:{...input,expectedVersion:order.version,operationsReviewId:order.operationsReview!.id}};
      return request(`${orderPath(site.id,order.id)}/team-lead-assignment`,z.object({workOrderId:z.string().uuid(),leadUserId:z.string().uuid(),operationsReviewId:z.string().uuid(),powertrainClass:z.enum(["EV","HYB","ICE"]),assignedAt:z.iso.datetime()}),{method:"POST",commandId:attempt.current.id,body:attempt.current.body});
    },
    onSuccess:()=>{attempt.current=null;setReason("");setLeadUserId("");void client.invalidateQueries({queryKey:["work-order",site.id,order.id]});void client.invalidateQueries({queryKey:["work-orders",site.id]});refresh();},
    onError:(error)=>{if(error instanceof ApiError&&error.status===409){attempt.current=null;void client.invalidateQueries({queryKey:["work-order",site.id,order.id]});}},
  });
  function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();mutation.mutate({leadUserId,reason:reason.trim()});}
  const currentReview=order.operationsReview?.isCurrent===true;
  const assignment=order.teamLeadAssignment;
  const currentAssignment=Boolean(assignment&&order.operationsReview
    &&assignment.operationsReviewId===order.operationsReview.id
    &&order.version===order.operationsReview.reviewedWorkOrderVersion+1);
  const canOfferAssignment=Boolean(currentReview&&eligible.data?.canAssign&&eligible.data.blockReason===null&&!currentAssignment);
  return <section className="panel mb-6 border-l-4 border-l-emerald-700" aria-labelledby="operations-assignment-title">
    <div className="panel-heading"><h2 id="operations-assignment-title" tabIndex={-1} className="section-title scroll-mt-24">Team-lead assignment</h2><Badge>{currentAssignment?"Team lead assigned":assignment?"Review needed":"Awaiting assignment"}</Badge></div>
    <div className="space-y-5 p-5 sm:p-6">
      {assignment?<>
        <dl className="grid gap-4 sm:grid-cols-2">
          <div><dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Assigned team lead</dt><dd className="mt-1 font-medium">{assignment.leadName}</dd></div>
          <div><dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Vehicle type</dt><dd className="mt-1">{assignment.powertrainClass}{assignment.powertrainClass==="HYB"?" · Operations selected a qualified hybrid lead":""}</dd></div>
          <div><dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Assigned by</dt><dd className="mt-1 text-sm">{assignment.assignedByName} · {dateTime(assignment.assignedAt, site.timeZone)}</dd></div>
          <div className="sm:col-span-2"><dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Assignment reason</dt><dd className="mt-1 text-sm leading-6">{assignment.reason}</dd></div>
        </dl>
        {!currentAssignment&&<p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-950">This assignment is for an earlier job version. Operations must review the latest version before assigning a team lead again.</p>}
      </>:<p className="text-sm leading-6 text-zinc-600">Assign a currently qualified team lead after Operations has reviewed the latest version of this job. Assignment does not approve repairs or sign off technical completion.</p>}
      {!online?<p className="border-t border-zinc-100 pt-4 text-sm text-amber-800">Reconnect to check assignment permission and team-lead qualifications.</p>:eligible.isPending?<Loading label="Checking assignment permission and team-lead qualifications"/>:eligible.isError?<Failure error={eligible.error} retry={()=>void eligible.refetch()}/>:eligible.data?.blockReason==="authority-required"?<p className="border-t border-zinc-100 pt-4 text-sm text-zinc-600">You need current Operations permission to assign a team lead.</p>:eligible.data?.blockReason==="operations-review-required"?<p className="border-t border-zinc-100 pt-4 text-sm text-amber-800">Review the latest version of this job before assigning a team lead.</p>:eligible.data?.blockReason==="no-qualified-leads"?<p className="border-t border-zinc-100 pt-4 text-sm text-amber-800">No team lead currently meets the qualifications for this vehicle type. Assignment stays blocked until one does.</p>:canOfferAssignment?<form className="grid gap-4 border-t border-zinc-100 pt-5 sm:grid-cols-2" onSubmit={submit}>
        <div><label htmlFor="assignment-lead" className="space-y-1 text-sm font-medium">Team lead</label><select id="assignment-lead" className="block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5" required value={leadUserId} onChange={event=>setLeadUserId(event.target.value)} disabled={mutation.isPending} {...fieldErrorProps(mutation.error,"leadUserId","assignment-lead")}><option value="">Choose a team lead</option>{eligible.data?.teamLeads.map(person=><option key={person.id} value={person.id}>{person.name}</option>)}</select><FieldErrorMessage error={mutation.error} path="leadUserId" id="assignment-lead" /></div>
        <div className="sm:col-span-2"><label htmlFor="assignment-reason" className="space-y-1 text-sm font-medium">Assignment reason</label><textarea id="assignment-reason" className="block min-h-24 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 font-normal" required minLength={1} maxLength={1000} value={reason} onChange={event=>setReason(event.target.value)} disabled={mutation.isPending} placeholder="Record the team-lead routing decision." {...fieldErrorProps(mutation.error,"reason","assignment-reason")} /><FieldErrorMessage error={mutation.error} path="reason" id="assignment-reason" /></div>
        <div className="sm:col-span-2"><FormError error={mutation.error}/><p id="assignment-action-help" className="mb-2 text-sm text-zinc-600">{!online?"Reconnect to assign a team lead.":!leadUserId?"Choose a qualified team lead to continue.":!reason.trim()?"Enter an assignment reason to continue.":mutation.isPending?"Assignment is being saved.":"The assignment is ready to save."}</p><Button type="submit" aria-describedby="assignment-action-help" disabled={!online||mutation.isPending||!leadUserId||!reason.trim()}>{mutation.isPending?"Saving assignment…":"Assign team lead"}</Button></div>
      </form>:currentAssignment?<p className="border-t border-zinc-100 pt-4 text-sm text-zinc-600">This team lead is assigned to the current job version. If the job changes, Operations must review the new version before assigning a replacement.</p>:assignment?<p className="border-t border-zinc-100 pt-4 text-sm text-zinc-600">Review the latest job version before assigning a team lead again.</p>:<p className="border-t border-zinc-100 pt-4 text-sm text-zinc-600">Record and confirm the Operations review above before making an assignment.</p>}
    </div>
  </section>;
}

function TeamLeadWorkPlan({order,refresh}:{order:WorkOrder;refresh:()=>void}) {
  const {site}=useStaff();
  const online=useOnline();
  const client=useQueryClient();
  const notify=useToast();
  const [taskIds,setTaskIds]=useState(()=>order.tasks.map(task=>task.id));
  const [rationale,setRationale]=useState("");
  const attempt=useRef<{id:string;content:string;body:{expectedVersion:number;rationale:string;taskIds:string[]}}|null>(null);
  const mutation=useMutation({
    mutationFn:(input:{rationale:string;taskIds:string[]})=>{
      const content=JSON.stringify(input);
      if(!attempt.current||attempt.current.content!==content)attempt.current={id:crypto.randomUUID(),content,body:{...input,expectedVersion:order.version}};
      return request(`${orderPath(site.id,order.id)}/work-plan-revisions`,workPlanResultSchema,{method:"POST",commandId:attempt.current.id,body:attempt.current.body});
    },
    onSuccess:()=>{attempt.current=null;setRationale("");notify("Work-plan draft saved.");void client.invalidateQueries({queryKey:["work-order",site.id,order.id]});refresh();},
    onError:(error)=>{if(error instanceof ApiError&&error.status===409){attempt.current=null;void client.invalidateQueries({queryKey:["work-order",site.id,order.id]});}},
  });
  function toggleTask(id:string,checked:boolean){setTaskIds(current=>checked?[...current,id]:current.filter(item=>item!==id));}
  function moveTask(index:number,direction:-1|1){setTaskIds(current=>{const next=[...current];const target=index+direction;if(target<0||target>=next.length)return current;[next[index],next[target]]=[next[target]!,next[index]!];return next;});}
  function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();mutation.mutate({rationale:rationale.trim(),taskIds});}
  const blocked:Record<NonNullable<WorkOrder["workPlanBlockReason"]>,string>={
    "assigned-lead-required":"Only the assigned team lead can prepare this plan.",
    "operations-review-required":"Operations must review this job and assign a team lead first.",
    "site-write-required":"Your account can view, but not change, records at this service centre.",
    "authority-required":"You need current permission to prepare this work plan.",
    "qualification-required":"The assigned team lead needs a current qualification for this vehicle type.",
    "planned-tasks-required":"Add at least one proposed task before preparing the work plan.",
  };
  return <section className="panel mb-6 border-l-4 border-l-sky-600" aria-labelledby="work-plan-title">
    <div className="panel-heading"><h2 id="work-plan-title" tabIndex={-1} className="section-title scroll-mt-24">Team lead's work plan</h2><Badge>{order.workPlan?`Version ${order.workPlan.revisionNumber}${order.workPlan.isCurrent?" · current":" · needs refresh"}`:"Draft required"}</Badge></div>
    <div className="space-y-5 p-5 sm:p-6">
      <p className="text-sm leading-6 text-zinc-600">Arrange the proposed tasks in the order they should be done, and explain why. This draft does not give permission to start work or approve extra or changed repairs.</p>
      {order.workPlan&&<div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4"><p className="text-sm font-semibold">Latest draft · {dateTime(order.workPlan.plannedAt, site.timeZone)} · {order.workPlan.plannedBy}</p><p className="mt-1 text-sm text-zinc-600">{order.workPlan.rationale}</p><ol className="mt-3 list-decimal space-y-1 pl-5 text-sm">{order.workPlan.tasks.map(task=><li key={task.taskId}><span className="font-medium">{task.reference}</span> · {task.title}</li>)}</ol></div>}
      {!order.canPrepareWorkPlan&&order.workPlanBlockReason&&<p className="text-sm text-amber-800">{blocked[order.workPlanBlockReason]}</p>}
      {order.canPrepareWorkPlan&&<form className="grid gap-4 border-t border-zinc-100 pt-5" onSubmit={submit}>
        <fieldset id="work-plan-tasks" className="min-w-0 space-y-3" disabled={!online||mutation.isPending} {...fieldErrorProps(mutation.error,"taskIds","work-plan-tasks")}>
          <legend className="text-sm font-semibold">Order of proposed tasks</legend>
          {order.tasks.length?order.tasks.map(task=>{
            const index=taskIds.indexOf(task.id);
            return <div key={task.id} className="flex min-w-0 items-center gap-3 rounded-lg border border-zinc-200 bg-white p-3">
              <input aria-label={`Include ${task.reference}`} type="checkbox" checked={index>=0} onChange={event=>toggleTask(task.id,event.target.checked)} />
              <span className="min-w-0 flex-1 text-sm"><span className="font-semibold">{task.reference}</span> · {task.title}</span>
              {index>=0&&<span className="text-xs text-zinc-500">{index+1}</span>}
              <Button type="button" variant="secondary" aria-label={`Move ${task.reference} up`} disabled={index<=0} onClick={()=>moveTask(index,-1)}><ArrowUp className="size-4" aria-hidden="true" /></Button>
              <Button type="button" variant="secondary" aria-label={`Move ${task.reference} down`} disabled={index<0||index===taskIds.length-1} onClick={()=>moveTask(index,1)}><ArrowDown className="size-4" aria-hidden="true" /></Button>
            </div>;
          }):<p className="text-sm text-zinc-500">No tasks have been added to this job yet.</p>}
        </fieldset>
        <FieldErrorMessage error={mutation.error} path="taskIds" id="work-plan-tasks" />
        <div><label htmlFor="work-plan-rationale" className="space-y-1 text-sm font-medium">Reason for this plan</label><textarea id="work-plan-rationale" className="block min-h-24 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 font-normal" required minLength={1} maxLength={1000} value={rationale} onChange={event=>setRationale(event.target.value)} disabled={!online||mutation.isPending} placeholder="Explain how the proposed tasks are arranged for the supervisor." {...fieldErrorProps(mutation.error,"rationale","work-plan-rationale")} /><FieldErrorMessage error={mutation.error} path="rationale" id="work-plan-rationale" /></div>
        {!online&&<p className="text-sm text-amber-800">Reconnect to save an updated work plan.</p>}
        <div><FormError error={mutation.error}/><p id="work-plan-action-help" className="mb-2 text-sm text-zinc-600">{!online?"Reconnect to save this work plan.":taskIds.length===0?"Choose at least one proposed task to continue.":!rationale.trim()?"Explain why the tasks are arranged this way.":mutation.isPending?"Work plan is being saved.":"The work plan is ready to save."}</p><Button type="submit" aria-describedby="work-plan-action-help" disabled={!online||mutation.isPending||!rationale.trim()||taskIds.length===0}>{mutation.isPending?"Saving draft…":order.workPlan?"Save updated plan":"Save work-plan draft"}</Button></div>
      </form>}
    </div>
  </section>;
}

function SupervisorHandoff({order,refresh}:{order:WorkOrder;refresh:()=>void}) {
  const {site}=useStaff();
  const online=useOnline();
  const client=useQueryClient();
  const [supervisorUserId,setSupervisorUserId]=useState("");
  const [reason,setReason]=useState("");
  const attempt=useRef<{id:string;content:string;body:{expectedVersion:number;supervisorUserId:string;workPlanRevisionId:string;reason:string}}|null>(null);
  const eligible=useQuery({
    queryKey:["eligible-supervisors",site.id,order.id,order.teamLeadAssignment?.leadUserId,order.version],
    queryFn:()=>request(eligibleSupervisorsPath(site.id,order.id),eligibleSupervisorsSchema),
    enabled:Boolean(order.teamLeadAssignment&&online),retry:false,
  });
  const mutation=useMutation({
    mutationFn:(input:{supervisorUserId:string;workPlanRevisionId:string;reason:string})=>{
      const content=JSON.stringify(input);
      if(!attempt.current||attempt.current.content!==content)attempt.current={id:crypto.randomUUID(),content,body:{...input,expectedVersion:order.version}};
      return request(`${orderPath(site.id,order.id)}/supervisor-handoff`,z.object({workOrderId:z.string().uuid(),supervisorUserId:z.string().uuid(),powertrainClass:z.enum(["EV","HYB","ICE"]),assignedAt:z.iso.datetime(),workPlanRevisionId:z.string().uuid(),workPlanRevisionNumber:z.number().int().positive(),version:z.number().int().positive()}),{method:"POST",commandId:attempt.current.id,body:attempt.current.body});
    },
    onSuccess:()=>{attempt.current=null;setReason("");void client.invalidateQueries({queryKey:["work-order",site.id,order.id]});void client.invalidateQueries({queryKey:["work-orders",site.id]});refresh();},
    onError:(error)=>{if(error instanceof ApiError&&error.status===409){attempt.current=null;void client.invalidateQueries({queryKey:["work-order",site.id,order.id]});}},
  });
  function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();if(order.workPlan?.isCurrent)mutation.mutate({supervisorUserId,workPlanRevisionId:order.workPlan.id,reason:reason.trim()});}
  return <section className="panel mb-6 border-l-4 border-l-amber-500" aria-labelledby="supervisor-handoff-title">
    <div className="panel-heading"><h2 id="supervisor-handoff-title" tabIndex={-1} className="section-title scroll-mt-24">Assign a supervisor</h2><Badge>{order.supervisorHandoff?(order.supervisorHandoff.isCurrent?"Supervisor assigned":"Handover needs updating"):"Awaiting team lead"}</Badge></div>
    <div className="space-y-5 p-5 sm:p-6">
      {order.supervisorHandoff?<dl className="grid gap-4 sm:grid-cols-2"><div><dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Assigned supervisor</dt><dd className="mt-1 font-medium">{order.supervisorHandoff.supervisorName}</dd></div><div><dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Assigned by</dt><dd className="mt-1 text-sm">{order.supervisorHandoff.assignedByName} · {dateTime(order.supervisorHandoff.assignedAt, site.timeZone)}</dd></div><div className="sm:col-span-2"><dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Handover note</dt><dd className="mt-1 text-sm leading-6">{order.supervisorHandoff.reason}</dd></div></dl>:<p className="text-sm leading-6 text-zinc-600">The assigned team lead records the handover after preparing the work plan. Assigning a supervisor does not sign off technical completion.</p>}
      {!order.teamLeadAssignment?<p className="text-sm text-amber-800">Assign a team lead before handing over this job.</p>:!order.workPlan?.isCurrent?<p className="border-t border-zinc-100 pt-4 text-sm text-amber-800">Prepare an up-to-date work-plan draft before assigning a supervisor. Any change to the plan or job requires a new handover.</p>:!online?<p className="border-t border-zinc-100 pt-4 text-sm text-amber-800">Reconnect to load qualified supervisors and record the handover.</p>:eligible.isPending?<Loading label="Loading qualified supervisors"/>:eligible.isError?<Failure error={eligible.error} retry={()=>void eligible.refetch()}/>:eligible.data&&!eligible.data.canHandoff?<p className="border-t border-zinc-100 pt-4 text-sm text-zinc-600">Only the assigned team lead with current permission can assign a supervisor.</p>:eligible.data?.supervisors.length?<form className="grid gap-4 border-t border-zinc-100 pt-5 sm:grid-cols-2" onSubmit={submit}>
        <div><label htmlFor="handoff-supervisor" className="space-y-1 text-sm font-medium">Qualified supervisor</label><select id="handoff-supervisor" className="block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5" required value={supervisorUserId} onChange={event=>setSupervisorUserId(event.target.value)} disabled={mutation.isPending} {...fieldErrorProps(mutation.error,"supervisorUserId","handoff-supervisor")}><option value="">Choose a supervisor</option>{eligible.data.supervisors.map(person=><option key={person.id} value={person.id}>{person.name}</option>)}</select><FieldErrorMessage error={mutation.error} path="supervisorUserId" id="handoff-supervisor" /></div>
        <div className="sm:col-span-2"><label htmlFor="handoff-reason" className="space-y-1 text-sm font-medium">Work plan and handover note</label><textarea id="handoff-reason" className="block min-h-24 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 font-normal" required minLength={1} maxLength={1000} value={reason} onChange={event=>setReason(event.target.value)} disabled={mutation.isPending} placeholder="Summarise the prepared plan and what the supervisor is taking over." {...fieldErrorProps(mutation.error,"reason","handoff-reason")} /><FieldErrorMessage error={mutation.error} path="reason" id="handoff-reason" /></div>
        <div className="sm:col-span-2"><FormError error={mutation.error}/><p id="handoff-action-help" className="mb-2 text-sm text-zinc-600">{!online?"Reconnect to record this handover.":!supervisorUserId?"Choose a qualified supervisor to continue.":!reason.trim()?"Enter a handover note to continue.":mutation.isPending?"Supervisor assignment is being saved.":"The supervisor assignment is ready to save."}</p><Button type="submit" aria-describedby="handoff-action-help" disabled={!online||mutation.isPending||!supervisorUserId||!reason.trim()}>{mutation.isPending?"Saving assignment…":order.supervisorHandoff?"Reassign supervisor":"Assign supervisor"}</Button></div>
      </form>:<p className="border-t border-zinc-100 pt-4 text-sm text-zinc-600">No supervisor with a current qualification for this service centre is available. Ask a site administrator to check the supervisor’s permission and qualifications.</p>}
    </div>
  </section>;
}

function eventLabel(action: string) {
  const labels: Record<string, string> = {
    "intake.created": "Reception draft created",
    "intake.draft.created": "Reception draft created",
    "reception.draft-created": "Reception draft created",
    "complaint.added": "Customer concern added",
    "workshop.complaint-added": "Customer concern added",
    "task.planned": "Task planned",
    "workshop.task-planned": "Task planned",
    "hold.opened": "Hold reported",
    "safety.hold-opened": "Hold reported",
    "diagnostic.finding-recorded": "Diagnostic finding recorded",
    "intake.fact-recorded": "Reception observation recorded",
    "work-order.evidence-attached": "Evidence attached",
    "work-order.plan-revised": "Work plan revised",
    "work-order.supervisor-handed-off": "Supervisor assigned",
    "operations.work-order-reviewed": "Operations review recorded",
    "operations.team-lead-assigned": "Team lead assigned",
  };
  return labels[action] ?? action.replaceAll(/[_.]/g, " ");
}

function diagnosticObservationLabel(observation: DiagnosticObservation) {
  switch (observation.kind) {
    case "dtc":
      return `DTC ${observation.code}${observation.system ? ` · ${observation.system}` : ""}${observation.status ? ` · ${observation.status}` : ""}${observation.freezeFrame?.length ? ` · Diagnostic snapshot readings: ${observation.freezeFrame.map((item) => `${item.name} ${item.value}${item.unit ? ` ${item.unit}` : ""}`).join(", ")}` : ""}`;
    case "software-version": return `${observation.component} software version ${observation.version}`;
    case "condition": return `Condition: ${observation.description}`;
    case "measurement": return `${observation.name}: ${observation.value} ${observation.unit}${observation.condition ? ` · ${observation.condition}` : ""}`;
    case "reproduction-attempt": return `Reproduction attempt · ${observation.conditions} · ${observation.outcome}`;
    case "procedure-reference": return `Procedure: ${observation.title} · ${observation.source}${observation.revision ? ` · ${observation.revision}` : ""}`;
  }
}

function localDateTimeValue() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

type FormProps = { order: WorkOrder; onSaved: () => void; onClose: () => void };
function CloseForm({ onClose }: Pick<FormProps, "onClose">) {
  return (
    <Button
      variant="secondary"
      type="button"
      onClick={onClose}
      aria-label="Close form"
    >
      <X className="size-4" aria-hidden="true" />
    </Button>
  );
}

function ComplaintForm({ order, onSaved, onClose }: FormProps) {
  const [wording, setWording] = useState("");
  const mutation = useOrderCommand(order, "complaints", onSaved);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    mutation.mutate({ wording: wording.trim() });
  }
  return (
    <form
      id="complaint-form"
      className="space-y-4 border-t border-zinc-200 bg-zinc-50 p-5 sm:p-6"
      onSubmit={submit}
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">Add another concern</h3>
        <CloseForm onClose={onClose} />
      </div>
      <label htmlFor="new-complaint">Customer's wording</label>
      <textarea
        id="new-complaint"
        required
        maxLength={4000}
        value={wording}
        onChange={(event) => setWording(event.target.value)}
        disabled={mutation.isPending}
        {...fieldErrorProps(mutation.error, "wording", "new-complaint")}
      />
      <FieldErrorMessage error={mutation.error} path="wording" id="new-complaint" />
      <FormError error={mutation.error} />
      <Button type="submit" disabled={mutation.isPending}>
        {mutation.isPending ? "Saving…" : "Save concern"}
      </Button>
    </form>
  );
}

function TaskForm({ order, onSaved, onClose }: FormProps) {
  const [title, setTitle] = useState("");
  const [complaintId, setComplaintId] = useState(order.complaints[0]?.id ?? "");
  const mutation = useOrderCommand(order, "tasks", onSaved);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    mutation.mutate({ complaintId, title: title.trim() });
  }
  return (
    <form
      id="task-form"
      className="space-y-4 border-t border-zinc-200 bg-zinc-50 p-5 sm:p-6"
      onSubmit={submit}
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">Plan a task</h3>
        <CloseForm onClose={onClose} />
      </div>
      <div>
        <label htmlFor="task-complaint">Customer concern</label>
        <select
          id="task-complaint"
          required
          value={complaintId}
          onChange={(event) => setComplaintId(event.target.value)}
          disabled={mutation.isPending}
          {...fieldErrorProps(mutation.error, "complaintId", "task-complaint")}
        >
          {order.complaints.map((complaint) => (
            <option key={complaint.id} value={complaint.id}>
              {complaint.reference} · {complaint.wording.slice(0, 80)}
            </option>
          ))}
        </select>
        <FieldErrorMessage error={mutation.error} path="complaintId" id="task-complaint" />
      </div>
      <div>
        <label htmlFor="task-title">Proposed task</label>
        <input
          id="task-title"
          required
          maxLength={500}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          disabled={mutation.isPending}
          {...fieldErrorProps(mutation.error, "title", "task-title")}
        />
        <FieldErrorMessage error={mutation.error} path="title" id="task-title" />
      </div>
      <FormError error={mutation.error} />
      <Button type="submit" disabled={mutation.isPending}>
        {mutation.isPending ? "Saving…" : "Save planned task"}
      </Button>
    </form>
  );
}

type ObservationKind = DiagnosticObservation["kind"];
const observationKinds: ObservationKind[] = [
  "dtc", "software-version", "condition", "measurement", "reproduction-attempt", "procedure-reference",
];
const emptyObservationFields = {
  code: "", system: "", status: "", freezeFrameName: "", freezeFrameValue: "", freezeFrameUnit: "", component: "", version: "",
  description: "", name: "", value: "", unit: "", condition: "", conditions: "",
  outcome: "", title: "", source: "", revision: "",
};
type FreezeFrameValue = { name: string; value: string; unit: string };

function DiagnosticForm({ order, onSaved, onClose }: FormProps) {
  const { site } = useStaff();
  const [complaintId, setComplaintId] = useState(order.complaints[0]?.id ?? "");
  const [taskId, setTaskId] = useState("");
  const [supersedesFindingId, setSupersedesFindingId] = useState("");
  const [observedAt, setObservedAt] = useState(localDateTimeValue);
  const [summary, setSummary] = useState("");
  const [certaintyState, setCertaintyState] = useState<"stated" | "inconclusive">("stated");
  const [certaintyExplanation, setCertaintyExplanation] = useState("");
  const [residualRisk, setResidualRisk] = useState("");
  const [restrictions, setRestrictions] = useState("");
  const [observationKind, setObservationKind] = useState<ObservationKind>("condition");
  const [fields, setFields] = useState(emptyObservationFields);
  const [freezeFrameValues, setFreezeFrameValues] = useState<FreezeFrameValue[]>([]);
  const [observations, setObservations] = useState<DiagnosticObservation[]>([]);
  const [observationStatus, setObservationStatus] = useState("");
  const [observationError, setObservationError] = useState<string | null>(null);
  const observationFocusTarget = useRef<string | null>(null);
  const [evidenceIds, setEvidenceIds] = useState<string[]>([]);
  const mutation = useOrderCommand(order, "diagnostic-findings", onSaved);
  useEffect(() => {
    const targetId = observationFocusTarget.current;
    if (!targetId) return;
    observationFocusTarget.current = null;
    document.getElementById(targetId)?.focus();
  }, [observations]);
  const linkedTasks = order.tasks.filter((task) => task.complaintId === complaintId);
  const priorFindings = order.diagnosticFindings.filter(
    (finding) => finding.complaintId === complaintId && finding.taskId === (taskId || null),
  );

  function addObservation() {
    const freezeFrameName = fields.freezeFrameName.trim();
    const freezeFrameValue = fields.freezeFrameValue.trim();
    const freezeFrameUnit = fields.freezeFrameUnit.trim();
    const hasFreezeFrameDraft = Boolean(freezeFrameName || freezeFrameValue || freezeFrameUnit);
    if (observationKind === "dtc" && hasFreezeFrameDraft && (!freezeFrameName || !freezeFrameValue)) {
      setObservationError("Enter both the reading name and value, or clear both fields.");
      return;
    }
    const freezeFrame = observationKind === "dtc"
      ? [...freezeFrameValues, ...(hasFreezeFrameDraft ? [{ name: freezeFrameName, value: freezeFrameValue, ...(freezeFrameUnit && { unit: freezeFrameUnit }) }] : [])]
      : undefined;
    if (freezeFrame && freezeFrame.length > 100) {
      setObservationError("A diagnostic trouble code can include at most 100 snapshot readings.");
      return;
    }
    const candidate: unknown = observationKind === "dtc"
      ? { kind: "dtc", code: fields.code, ...(fields.system && { system: fields.system }), ...(fields.status && { status: fields.status }), ...(freezeFrame?.length && { freezeFrame }) }
      : observationKind === "software-version"
        ? { kind: observationKind, component: fields.component, version: fields.version }
        : observationKind === "condition"
          ? { kind: observationKind, description: fields.description }
          : observationKind === "measurement"
            ? { kind: observationKind, name: fields.name, value: fields.value, unit: fields.unit, ...(fields.condition && { condition: fields.condition }) }
            : observationKind === "reproduction-attempt"
              ? { kind: observationKind, conditions: fields.conditions, outcome: fields.outcome }
              : { kind: observationKind, title: fields.title, source: fields.source, ...(fields.revision && { revision: fields.revision }) };
    const parsed = diagnosticObservationSchema.safeParse(candidate);
    if (!parsed.success) {
      setObservationError(parsed.error.issues[0]?.message ?? "Complete the observation fields.");
      return;
    }
    setObservations((current) => [...current, parsed.data]);
    setObservationStatus(`Added ${observationKind.replaceAll("-", " ")} observation.`);
    setFields(emptyObservationFields);
    setFreezeFrameValues([]);
    setObservationError(null);
  }

  function addFreezeFrameValue() {
    const name = fields.freezeFrameName.trim();
    const value = fields.freezeFrameValue.trim();
    if (!name || !value) {
      setObservationError("Enter a reading name and value.");
      return;
    }
    if (freezeFrameValues.length >= 100) {
      setObservationError("A diagnostic trouble code can include at most 100 snapshot readings.");
      return;
    }
    setFreezeFrameValues((current) => [...current, { name, value, unit: fields.freezeFrameUnit.trim() }]);
    setObservationStatus(`Added a measurement for ${name}.`);
    setFields((current) => ({ ...current, freezeFrameName: "", freezeFrameValue: "", freezeFrameUnit: "" }));
    setObservationError(null);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (observations.length === 0) {
      setObservationError("Add at least one structured observation before saving.");
      return;
    }
    mutation.mutate({
      complaintId,
      taskId: taskId || null,
      supersedesFindingId: supersedesFindingId || null,
      observedAt: new Date(observedAt).toISOString(),
      summary: summary.trim(),
      certainty: { state: certaintyState, explanation: certaintyExplanation.trim() },
      residualRisk: residualRisk.trim(),
      restrictions: restrictions.trim() || null,
      observations,
      evidenceIds,
    });
  }

  function removeFreezeFrameValue(index: number) {
    const removed = freezeFrameValues[index];
    setFreezeFrameValues((current) => current.filter((_, currentIndex) => currentIndex !== index));
    setObservationStatus(`Removed the ${removed?.name ?? "selected"} measurement.`);
    const nextIndex = index < freezeFrameValues.length - 1 ? index : index - 1;
    window.requestAnimationFrame(() => {
      (nextIndex >= 0 ? document.getElementById(`remove-freeze-frame-${nextIndex}`) : document.getElementById("add-freeze-frame-value"))?.focus();
    });
  }

  function removeObservation(index: number) {
    const removed = observations[index];
    const nextIndex = index < observations.length - 1 ? index : index - 1;
    observationFocusTarget.current = nextIndex >= 0 ? `remove-observation-${nextIndex}` : "add-observation";
    setObservations((current) => current.filter((_, currentIndex) => currentIndex !== index));
    setObservationStatus(`Removed ${removed?.kind.replaceAll("-", " ") ?? "diagnostic"} observation.`);
  }

  const setField = (name: keyof typeof fields, value: string) =>
    setFields((current) => ({ ...current, [name]: value }));
  const observationFieldPath = (name: keyof typeof fields) => name.startsWith("freezeFrame")
    ? `observations.0.freezeFrame.0.${name === "freezeFrameName" ? "name" : name === "freezeFrameValue" ? "value" : "unit"}`
    : `observations.0.${name}`;
  const textField = (name: keyof typeof fields, label: string, required = true) => (
    <div key={name}>
      <label htmlFor={`diagnostic-${name}`}>{label}</label>
      <input id={`diagnostic-${name}`} required={required && observations.length === 0} value={fields[name]} onChange={(event) => setField(name, event.target.value)} disabled={mutation.isPending} {...fieldErrorProps(mutation.error,observationFieldPath(name),`diagnostic-${name}`)} />
      <FieldErrorMessage error={mutation.error} path={observationFieldPath(name)} id={`diagnostic-${name}`} />
    </div>
  );
  const textArea = (name: keyof typeof fields, label: string, required = true, hint?: string) => (
    <div key={name}>
      <label htmlFor={`diagnostic-${name}`}>{label}</label>
      <textarea id={`diagnostic-${name}`} required={required && observations.length === 0} value={fields[name]} onChange={(event) => setField(name, event.target.value)} disabled={mutation.isPending} {...fieldErrorProps(mutation.error,observationFieldPath(name),`diagnostic-${name}`)} aria-describedby={[hint && `diagnostic-${name}-hint`,fieldErrorMessage(mutation.error,observationFieldPath(name)) && `diagnostic-${name}-error`].filter(Boolean).join(" ") || undefined} />
      <FieldErrorMessage error={mutation.error} path={observationFieldPath(name)} id={`diagnostic-${name}`} />
      {hint && <p id={`diagnostic-${name}-hint`} className="field-hint">{hint}</p>}
    </div>
  );

  return (
    <form id="diagnostic-form" className="space-y-5 border-t border-zinc-200 bg-zinc-50 p-5 sm:p-6" onSubmit={submit}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Record diagnostic finding</h3>
          <p className="mt-1 text-xs leading-5 text-zinc-500">This saves attributed observations. It does not authorize tests, repairs or release.</p>
        </div>
        <CloseForm onClose={onClose} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="diagnostic-complaint">Customer concern</label>
          <select id="diagnostic-complaint" required value={complaintId} onChange={(event) => { setComplaintId(event.target.value); setTaskId(""); setSupersedesFindingId(""); }} disabled={mutation.isPending} {...fieldErrorProps(mutation.error,"complaintId","diagnostic-complaint")}>
            {order.complaints.map((item) => <option key={item.id} value={item.id}>{item.reference} · {item.wording.slice(0, 80)}</option>)}
          </select>
          <FieldErrorMessage error={mutation.error} path="complaintId" id="diagnostic-complaint" />
        </div>
        <div>
          <label htmlFor="diagnostic-task">Related planned task <span className="font-normal text-zinc-500">(optional)</span></label>
          <select id="diagnostic-task" value={taskId} onChange={(event) => { setTaskId(event.target.value); setSupersedesFindingId(""); }} disabled={mutation.isPending} {...fieldErrorProps(mutation.error,"taskId","diagnostic-task")}>
            <option value="">No related task</option>
            {linkedTasks.map((item) => <option key={item.id} value={item.id}>{item.reference} · {item.title}</option>)}
          </select>
          <FieldErrorMessage error={mutation.error} path="taskId" id="diagnostic-task" />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div><label htmlFor="diagnostic-observed-at">Observed at</label><input id="diagnostic-observed-at" type="datetime-local" required value={observedAt} onChange={(event) => setObservedAt(event.target.value)} disabled={mutation.isPending} {...fieldErrorProps(mutation.error,"observedAt","diagnostic-observed-at")} /><FieldErrorMessage error={mutation.error} path="observedAt" id="diagnostic-observed-at" /></div>
        <div>
          <label htmlFor="diagnostic-supersedes">Corrects an earlier finding <span className="font-normal text-zinc-500">(optional)</span></label>
          <select id="diagnostic-supersedes" value={supersedesFindingId} onChange={(event) => setSupersedesFindingId(event.target.value)} disabled={mutation.isPending} {...fieldErrorProps(mutation.error,"supersedesFindingId","diagnostic-supersedes")}>
            <option value="">No earlier finding</option>
            {priorFindings.map((item) => <option key={item.id} value={item.id}>{dateTime(item.recordedAt, site.timeZone)} · {item.summary.slice(0, 70)}</option>)}
          </select>
          <FieldErrorMessage error={mutation.error} path="supersedesFindingId" id="diagnostic-supersedes" />
        </div>
      </div>
      <div><label htmlFor="diagnostic-summary">Finding summary</label><textarea id="diagnostic-summary" required maxLength={4000} value={summary} onChange={(event) => setSummary(event.target.value)} disabled={mutation.isPending} {...fieldErrorProps(mutation.error,"summary","diagnostic-summary")} /><FieldErrorMessage error={mutation.error} path="summary" id="diagnostic-summary" /></div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="diagnostic-certainty">How certain is this finding?</label>
          <select id="diagnostic-certainty" value={certaintyState} onChange={(event) => setCertaintyState(event.target.value as "stated" | "inconclusive")} disabled={mutation.isPending} {...fieldErrorProps(mutation.error,"certainty.state","diagnostic-certainty")}>
            <option value="stated">Stated by staff member</option>
            <option value="inconclusive">Inconclusive / unresolved</option>
          </select>
        </div>
        <div><label htmlFor="diagnostic-certainty-explanation">Why did you choose this option?</label><input id="diagnostic-certainty-explanation" required maxLength={2000} value={certaintyExplanation} onChange={(event) => setCertaintyExplanation(event.target.value)} disabled={mutation.isPending} {...fieldErrorProps(mutation.error,"certainty.explanation","diagnostic-certainty-explanation")} /><FieldErrorMessage error={mutation.error} path="certainty.explanation" id="diagnostic-certainty-explanation" /></div>
      </div>
      <div><label htmlFor="diagnostic-residual-risk">Residual risk or what remains unknown</label><textarea id="diagnostic-residual-risk" required maxLength={4000} value={residualRisk} onChange={(event) => setResidualRisk(event.target.value)} disabled={mutation.isPending} {...fieldErrorProps(mutation.error,"residualRisk","diagnostic-residual-risk")} /><FieldErrorMessage error={mutation.error} path="residualRisk" id="diagnostic-residual-risk" /></div>
      <div><label htmlFor="diagnostic-restrictions">Restrictions or follow-up <span className="font-normal text-zinc-500">(optional)</span></label><textarea id="diagnostic-restrictions" maxLength={2000} value={restrictions} onChange={(event) => setRestrictions(event.target.value)} disabled={mutation.isPending} {...fieldErrorProps(mutation.error,"restrictions","diagnostic-restrictions")} /><FieldErrorMessage error={mutation.error} path="restrictions" id="diagnostic-restrictions" /></div>

      <fieldset id="diagnostic-observations" className="space-y-4 rounded-lg border border-zinc-200 p-4" {...fieldErrorProps(mutation.error,"observations","diagnostic-observations")}>
        <legend className="px-1 text-sm font-semibold">Detailed observations</legend>
        <div>
          <label htmlFor="diagnostic-observation-kind">Observation type</label>
          <select id="diagnostic-observation-kind" value={observationKind} onChange={(event) => { setObservationKind(event.target.value as ObservationKind); setFields(emptyObservationFields); setFreezeFrameValues([]); setObservationError(null); }} disabled={mutation.isPending}>
            {observationKinds.map((kind) => <option key={kind} value={kind}>{kind.replaceAll("-", " ")}</option>)}
          </select>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {observationKind === "dtc" && <>
            {textField("code", "Diagnostic trouble code")}
            {textField("system", "System", false)}
            {textField("status", "Code status", false)}
            <div className="space-y-3 rounded-lg border border-zinc-200 bg-white p-3 sm:col-span-2">
              <p className="text-sm font-medium text-zinc-700">Diagnostic snapshot readings <span className="font-normal text-zinc-500">(optional)</span></p>
              <p className="field-hint">Often called freeze-frame data by diagnostic tools. These readings show vehicle conditions when a fault was recorded.</p>
              <div className="grid gap-3 sm:grid-cols-3">
                {textField("freezeFrameName", "Parameter name", false)}
                {textField("freezeFrameValue", "Value", false)}
                {textField("freezeFrameUnit", "Unit", false)}
              </div>
              <Button id="add-freeze-frame-value" type="button" variant="secondary" onClick={addFreezeFrameValue} disabled={mutation.isPending}>Add reading</Button>
              {freezeFrameValues.length > 0 && (
                <ul className="space-y-2 border-t border-zinc-200 pt-3" aria-label="Diagnostic snapshot readings added">
                  {freezeFrameValues.map((item, index) => (
                    <li key={`${item.name}-${index}`} className="flex items-start justify-between gap-3 text-sm text-zinc-700">
                      <span>{item.name}: {item.value}{item.unit ? ` ${item.unit}` : ""}</span>
                      <button id={`remove-freeze-frame-${index}`} type="button" className="min-h-11 shrink-0 px-2 text-xs text-zinc-600 underline" onClick={() => removeFreezeFrameValue(index)} aria-label={`Remove diagnostic snapshot reading ${index + 1}`} disabled={mutation.isPending}>Remove</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>}
          {observationKind === "software-version" && <>{textField("component", "Component or module")}{textField("version", "Software version")}</>}
          {observationKind === "condition" && textArea("description", "Observed condition")}
          {observationKind === "measurement" && <>{textField("name", "Measurement")}{textField("value", "Value")}{textField("unit", "Unit")}{textField("condition", "Measurement condition", false)}</>}
          {observationKind === "reproduction-attempt" && <>{textArea("conditions", "Attempt conditions")}{textArea("outcome", "Observed outcome")}</>}
          {observationKind === "procedure-reference" && <>{textField("title", "Procedure or manual title")}{textField("source", "Source reference")}{textField("revision", "Revision", false)}</>}
        </div>
        <Button id="add-observation" type="button" variant="secondary" onClick={addObservation} disabled={mutation.isPending}>Add observation</Button>
        <p className="sr-only" role="status" aria-live="polite">{observationStatus}</p>
        {observationError && <p role="alert" className="text-sm text-red-800">{observationError}</p>}
        {observations.length > 0 && (
          <ol className="space-y-2 border-t border-zinc-200 pt-3">
            {observations.map((item, index) => <li key={`${item.kind}-${index}`} className="flex items-start justify-between gap-3 text-sm text-zinc-700"><span>{diagnosticObservationLabel(item)}</span><button id={`remove-observation-${index}`} type="button" className="min-h-11 shrink-0 px-2 text-xs text-zinc-600 underline" onClick={() => removeObservation(index)} aria-label={`Remove observation ${index + 1}`} disabled={mutation.isPending}>Remove</button></li>)}
          </ol>
        )}
      </fieldset>

      {order.evidence.some((item) => item.state === "accepted" && item.attachedAt) && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Link files that passed the security check <span className="font-normal text-zinc-500">(optional)</span></legend>
          {order.evidence.filter((item) => item.state === "accepted" && item.attachedAt).map((item) => (
            <label key={item.evidenceId} className="flex items-start gap-3 text-sm font-normal text-zinc-700">
              <input type="checkbox" className="mt-1 size-4" checked={evidenceIds.includes(item.evidenceId)} onChange={(event) => setEvidenceIds((current) => event.target.checked ? [...current, item.evidenceId] : current.filter((id) => id !== item.evidenceId))} disabled={mutation.isPending} />
              <span>{item.displayName}</span>
            </label>
          ))}
        </fieldset>
      )}
      <FieldErrorMessage error={mutation.error} path="observations" id="diagnostic-observations" />
      <FormError error={mutation.error} />
      <Button type="submit" disabled={mutation.isPending || !complaintId}>
        {mutation.isPending ? "Saving finding…" : "Save diagnostic finding"}
      </Button>
    </form>
  );
}

const categorySchema = z.enum([
  "safety",
  "approval",
  "parts",
  "equipment",
  "competency",
  "other",
]);
const severitySchema = z.enum(["stop", "warning"]);
function HoldForm({ order, onSaved, onClose }: FormProps) {
  const [taskId, setTaskId] = useState("");
  const [category, setCategory] =
    useState<z.infer<typeof categorySchema>>("safety");
  const [severity, setSeverity] =
    useState<z.infer<typeof severitySchema>>("stop");
  const [reason, setReason] = useState("");
  const [source, setSource] = useState("");
  const mutation = useOrderCommand(order, "holds", onSaved);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    mutation.mutate({
      scope: taskId ? { kind: "task", taskId } : { kind: "workOrder" },
      category,
      severity,
      reason: reason.trim(),
      source: source.trim(),
    });
  }
  return (
    <form
      id="hold-form"
      className="space-y-4 border-t border-zinc-200 bg-zinc-50 p-5 sm:p-6"
      onSubmit={submit}
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">Report a hold</h3>
        <CloseForm onClose={onClose} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="hold-scope">What does this hold apply to?</label>
          <p id="hold-scope-hint" className="field-hint">Choose the whole work order or one planned task.</p>
          <select
            id="hold-scope"
            value={taskId}
            onChange={(event) => setTaskId(event.target.value)}
            disabled={mutation.isPending}
            {...fieldErrorProps(mutation.error, ["scope", "scope.kind", "scope.taskId"], "hold-scope")}
            aria-describedby={["hold-scope-hint", fieldErrorMessage(mutation.error, ["scope", "scope.kind", "scope.taskId"]) && "hold-scope-error"].filter(Boolean).join(" ")}
          >
            <option value="">Whole work order</option>
            {order.tasks.map((task) => (
              <option key={task.id} value={task.id}>
                {task.reference} · {task.title.slice(0, 60)}
              </option>
            ))}
          </select>
          <FieldErrorMessage error={mutation.error} path={["scope", "scope.kind", "scope.taskId"]} id="hold-scope" />
        </div>
        <div>
          <label htmlFor="hold-category">Category</label>
          <select
            id="hold-category"
            value={category}
            onChange={(event) =>
              setCategory(categorySchema.parse(event.target.value))
            }
            disabled={mutation.isPending}
            {...fieldErrorProps(mutation.error, "category", "hold-category")}
          >
            <option value="safety">Safety</option>
            <option value="approval">Approval</option>
            <option value="parts">Parts</option>
            <option value="equipment">Equipment</option>
            <option value="competency">Competency</option>
            <option value="other">Other</option>
          </select>
          <FieldErrorMessage error={mutation.error} path="category" id="hold-category" />
        </div>
        <div>
          <label htmlFor="hold-severity">Severity</label>
          <select
            id="hold-severity"
            value={severity}
            onChange={(event) =>
              setSeverity(severitySchema.parse(event.target.value))
            }
            disabled={mutation.isPending}
            {...fieldErrorProps(mutation.error, "severity", "hold-severity")}
          >
            <option value="stop">Stop affected work</option>
            <option value="warning">Warning</option>
          </select>
          <FieldErrorMessage error={mutation.error} path="severity" id="hold-severity" />
        </div>
      </div>
      <div>
        <label htmlFor="hold-reason">Reason</label>
        <textarea
          id="hold-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          required
          maxLength={4000}
          disabled={mutation.isPending}
          {...fieldErrorProps(mutation.error, "reason", "hold-reason")}
        />
        <FieldErrorMessage error={mutation.error} path="reason" id="hold-reason" />
      </div>
      <div>
        <label htmlFor="hold-source">Observation or source reference</label>
        <input
          id="hold-source"
          value={source}
          onChange={(event) => setSource(event.target.value)}
          required
          maxLength={1000}
          disabled={mutation.isPending}
          {...fieldErrorProps(mutation.error, "source", "hold-source")}
        />
        <FieldErrorMessage error={mutation.error} path="source" id="hold-source" />
        <p className="field-hint">
          Record what was observed or the source that prompted this hold.
        </p>
      </div>
      <p className="text-xs leading-5 text-zinc-500">
        You will be recorded as the hold owner. Reporting a hold does not grant
        authority to resolve it.
      </p>
      <FormError error={mutation.error} />
      <Button type="submit" disabled={mutation.isPending}>
        {mutation.isPending ? "Saving…" : "Save hold"}
      </Button>
    </form>
  );
}
