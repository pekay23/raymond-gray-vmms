import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { z } from "zod";
import {
  AlertTriangle,
  ChevronRight,
  Circle,
  Clock3,
  FileText,
  MessageSquarePlus,
  Plus,
  RefreshCw,
  ShieldAlert,
  Wrench,
  X,
} from "lucide-react";
import { ApiError, detailSchema, orderPath, request } from "../api";
import type { WorkOrder } from "../api";
import { BackToQueue, useStaff } from "../workspace";
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
} from "../ui";

export function WorkOrderDetail() {
  const { site } = useStaff();
  const { orderId } = useParams();
  const detail = useQuery({
    queryKey: ["work-order", site.id, orderId],
    queryFn: () => request(orderPath(site.id, orderId ?? ""), detailSchema),
    enabled: Boolean(orderId),
  });
  return (
    <>
      <BackToQueue />
      {detail.isPending ? (
        <Loading label="Loading work order" />
      ) : detail.isError ? (
        <Failure
          error={detail.error}
          retry={() => {
            void detail.refetch();
          }}
        />
      ) : (
        <Order
          order={detail.data}
          refresh={() => {
            void detail.refetch();
          }}
        />
      )}
    </>
  );
}

type CommandAttempt = {
  id: string;
  content: string;
  body: Record<string, unknown>;
};

function useOrderCommand(
  order: WorkOrder,
  command: "complaints" | "tasks" | "holds",
  onSaved: () => void,
) {
  const { site } = useStaff();
  const client = useQueryClient();
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
  const { site } = useStaff();
  const online = useOnline();
  const [panel, setPanel] = useState<"complaint" | "task" | "hold" | null>(
    null,
  );
  const [notice, setNotice] = useState<string | null>(null);
  const completed = () => {
    setPanel(null);
    setNotice("Saved to the work-order record.");
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
            <Badge>Reception draft</Badge>
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
        {order.vehicleLabel} <span className="mx-1 text-zinc-300">/</span>{" "}
        {order.registration}
      </PageHeading>
      {notice && (
        <p
          role="status"
          className="mb-5 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900"
        >
          {notice}
        </p>
      )}
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="min-w-0 space-y-6 xl:col-span-2">
          <section className="panel" aria-labelledby="visit-title">
            <div className="panel-heading">
              <h2 id="visit-title" className="section-title">
                Visit record
              </h2>
              <span className="text-xs text-zinc-500">
                Opened {dateTime(order.createdAt)}
              </span>
            </div>
            <dl className="grid gap-6 p-5 sm:grid-cols-2 sm:p-6">
              <div>
                <dt className="text-xs text-zinc-500">Customer</dt>
                <dd className="mt-1.5 text-sm font-semibold">
                  {order.customer.name}
                </dd>
                <dd className="mt-1 text-sm text-zinc-500">
                  {order.customer.phone}
                </dd>
                {order.customer.email && (
                  <dd className="mt-1 break-all text-sm text-zinc-500">
                    {order.customer.email}
                  </dd>
                )}
              </div>
              <div>
                <dt className="text-xs text-zinc-500">
                  Vehicle identification number
                </dt>
                <dd className="mt-1.5 break-all font-mono text-sm tabular-nums">
                  {order.vehicle.vin}
                </dd>
                <dd className="mt-3 text-xs text-zinc-500">
                  {order.odometerKm.toLocaleString("en-GH")} km{" "}
                  <span className="mx-2 text-zinc-300">·</span>{" "}
                  {order.socPercent === null
                    ? "SOC not recorded"
                    : `${order.socPercent}% charge`}
                </dd>
              </div>
            </dl>
          </section>
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
                onClose={() => setPanel(null)}
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
                onClose={() => setPanel(null)}
              />
            )}
            <p className="border-t border-zinc-100 px-6 py-3 text-xs leading-5 text-zinc-500">
              Planning a task does not authorise work or assign a technician.
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
                  Open holds
                </h2>
                <Badge>{order.holds.length}</Badge>
              </div>
              {site.canWrite && (
                <Button
                  variant="secondary"
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
                        tone={hold.severity === "stop" ? "danger" : "warning"}
                      >
                        <AlertTriangle className="size-3" aria-hidden="true" />
                        {hold.severity === "stop" ? "Stop" : "Warning"} ·{" "}
                        {hold.category}
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
                      Owner: {hold.openedBy} · {dateTime(hold.openedAt)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            {panel === "hold" && (
              <HoldForm
                order={order}
                onSaved={completed}
                onClose={() => setPanel(null)}
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
                        {event.actor} · {dateTime(event.at)}
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
            <p className="mt-2 text-xs leading-6 text-zinc-500">
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

function eventLabel(action: string) {
  const labels: Record<string, string> = {
    "intake.created": "Reception draft created",
    "intake.draft.created": "Reception draft created",
    "complaint.added": "Customer concern added",
    "task.planned": "Task planned",
    "hold.opened": "Hold reported",
  };
  return labels[action] ?? action.replaceAll(/[_.]/g, " ");
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
      />
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
        >
          {order.complaints.map((complaint) => (
            <option key={complaint.id} value={complaint.id}>
              {complaint.reference} · {complaint.wording.slice(0, 80)}
            </option>
          ))}
        </select>
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
        />
      </div>
      <FormError error={mutation.error} />
      <Button type="submit" disabled={mutation.isPending}>
        {mutation.isPending ? "Saving…" : "Save planned task"}
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
          <label htmlFor="hold-scope">Affected scope</label>
          <select
            id="hold-scope"
            value={taskId}
            onChange={(event) => setTaskId(event.target.value)}
            disabled={mutation.isPending}
          >
            <option value="">Whole work order</option>
            {order.tasks.map((task) => (
              <option key={task.id} value={task.id}>
                {task.reference} · {task.title.slice(0, 60)}
              </option>
            ))}
          </select>
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
          >
            <option value="safety">Safety</option>
            <option value="approval">Approval</option>
            <option value="parts">Parts</option>
            <option value="equipment">Equipment</option>
            <option value="competency">Competency</option>
            <option value="other">Other</option>
          </select>
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
          >
            <option value="stop">Stop affected work</option>
            <option value="warning">Warning</option>
          </select>
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
        />
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
        />
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
