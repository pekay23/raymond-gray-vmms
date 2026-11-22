import type { WorkOrder } from "./api";
import { Badge } from "./ui";

type CloseoutStage = WorkOrder["closeoutPath"][number];

const stateLabels: Record<CloseoutStage["state"], string> = {
  complete: "Done",
  current: "Current step",
  waiting: "Waiting",
  "not-available": "Not available yet",
};

const stateStyles: Record<CloseoutStage["state"], string> = {
  complete: "border-l-emerald-700",
  current: "border-l-sky-700",
  waiting: "border-l-zinc-300",
  "not-available": "border-l-amber-600",
};

export function WorkOrderCloseoutPath({ stages }: { stages: CloseoutStage[] }) {
  return (
    <section className="panel mb-6" aria-labelledby="work-order-closeout-title">
      <div className="panel-heading">
        <div>
          <h2 id="work-order-closeout-title" className="section-title">Job path</h2>
          <p className="mt-1 text-sm text-zinc-600">Who acts next, through the client update.</p>
        </div>
      </div>
      <ol className="divide-y divide-zinc-100 px-5 sm:px-6" aria-label="Workshop job stages">
        {stages.map((stage) => (
          <li
            key={stage.code}
            data-state={stage.state}
            aria-current={stage.state === "current" ? "step" : undefined}
            className={`border-l-2 py-3 pl-4 ${stateStyles[stage.state]}`}
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h3 className="text-sm font-semibold text-zinc-900">{stage.label}</h3>
              <Badge>{stateLabels[stage.state]}</Badge>
              <span className="text-xs text-zinc-600">{stage.responsibleRole}</span>
            </div>
            <p className="mt-1 max-w-4xl text-sm leading-5 text-zinc-700">{stage.detail}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
