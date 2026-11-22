import type { WorkOrder } from "./api";
import { Link } from "react-router-dom";

type Readiness = WorkOrder["completionReadiness"];

export function WorkOrderCompletionReadiness({
  readiness,
  siteId,
  workOrderId,
  canOpenTaskAssignments,
}: {
  readiness: Readiness;
  siteId: string;
  workOrderId: string;
  canOpenTaskAssignments: boolean;
}) {
  const taskLocation = (taskId: string) =>
    `/sites/${encodeURIComponent(siteId)}/work-orders/${encodeURIComponent(workOrderId)}#task-allocation-${encodeURIComponent(taskId)}`;

  return (
    <section className="panel mb-6" aria-labelledby="completion-readiness-title">
      <div className="panel-heading">
        <div>
          <h2 id="completion-readiness-title" className="section-title">Supervisor completion preparation</h2>
          <p className="mt-1 text-sm text-zinc-600">A live summary of recorded task work and what still prevents technical sign-off.</p>
        </div>
        <span className="inline-flex rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-900">Sign-off blocked</span>
      </div>

      <div className="space-y-5 px-5 py-5 sm:px-6">
        <div>
          <h3 className="text-sm font-semibold text-zinc-900">What must be resolved</h3>
          <ul className="mt-2 space-y-2">
            {readiness.blockers.map((blocker, index) => (
              <li key={`${blocker.code}-${blocker.taskId ?? "order"}-${index}`} className="border-l-2 border-amber-500 pl-3 text-sm leading-5 text-zinc-800">
                {blocker.message}
                {blocker.taskId && canOpenTaskAssignments && (
                  <Link
                    className="ml-2 inline-flex min-h-11 items-center font-semibold text-blue-800 underline decoration-blue-300 underline-offset-2 hover:text-blue-950"
                    to={taskLocation(blocker.taskId)}
                    aria-label={`Review task ${readiness.tasks.find(task => task.taskId === blocker.taskId)?.reference ?? "details"}`}
                    onClick={() => {
                      const target = document.getElementById(`task-allocation-${blocker.taskId}`);
                      if (!target) return;
                      target.focus({ preventScroll: true });
                      target.scrollIntoView({
                        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
                        block: "start",
                      });
                    }}
                  >
                    Review task
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-zinc-900">Current work plan tasks</h3>
          {!readiness.currentWorkPlan ? (
            <p className="mt-2 rounded-lg bg-zinc-50 px-3 py-3 text-sm text-zinc-700">There is no current work plan to review.</p>
          ) : readiness.tasks.length === 0 ? (
            <p className="mt-2 rounded-lg bg-zinc-50 px-3 py-3 text-sm text-zinc-700">The current work plan has no task lines.</p>
          ) : (
            <ul className="mt-2 divide-y divide-zinc-100 rounded-lg border border-zinc-200">
              {readiness.tasks.map((task) => (
                <li key={task.taskId} className="grid min-w-0 gap-3 px-3 py-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:px-4">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-zinc-900"><span className="font-mono text-xs text-zinc-500">{task.reference}</span> · {task.title}</p>
                    <p className="mt-1 text-xs text-zinc-600">Assigned to: {task.assigneeName ?? "No technician or engineer assigned"}</p>
                  </div>
                  <dl className="grid min-w-0 grid-cols-2 gap-x-4 gap-y-1 text-xs text-zinc-700 sm:grid-cols-2">
                    <div className="min-w-0"><dt className="break-words text-zinc-500">Work records</dt><dd className="font-semibold tabular-nums">{task.workEntryCount}</dd></div>
                    <div className="min-w-0"><dt className="break-words text-zinc-500">Actions marked done</dt><dd className="font-semibold tabular-nums">{task.completedActionCount}</dd></div>
                    <div className="min-w-0"><dt className="break-words text-zinc-500">Actions partial or blocked</dt><dd className="font-semibold tabular-nums">{task.openActionCount}</dd></div>
                    <div className="min-w-0"><dt className="break-words text-zinc-500">Follow-ups open</dt><dd className="font-semibold tabular-nums">{task.followUpCount}</dd></div>
                    <div className="min-w-0"><dt className="break-words text-zinc-500">Outcomes recorded</dt><dd className="font-semibold tabular-nums">{task.checklistOutcomeCount}</dd></div>
                    <div className="min-w-0"><dt className="break-words text-zinc-500">Outcomes without confirmed review</dt><dd className="font-semibold tabular-nums">{task.checklistNeedsReviewCount}</dd></div>
                  </dl>
                </li>
              ))}
            </ul>
          )}
        </div>

        <p className="border-t border-zinc-100 pt-4 text-xs leading-5 text-zinc-600">
          These counts summarize saved records only. They do not confirm that work is safe or complete. Checklist review, Supervisor completion, Team Lead release, Head inspection and customer updates remain separate decisions.
        </p>
      </div>
    </section>
  );
}
