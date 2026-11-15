import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { request, workOrderChecklistsPath, workOrderChecklistsSchema } from "./api";
import type { WorkOrder } from "./api";
import { Failure, Loading, useOnline } from "./ui";

export function WorkOrderChecklists({ order, siteId }: { order: WorkOrder; siteId: string }) {
  const online = useOnline();
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [order.id]);
  const result = useQuery({
    queryKey: ["work-order-checklists", siteId, order.id, page],
    queryFn: () => request(workOrderChecklistsPath(siteId, order.id, page, 10), workOrderChecklistsSchema),
    enabled: online,
    retry: false,
  });

  return (
    <section className="panel" aria-labelledby="checklists-title">
      <div className="panel-heading">
        <div>
          <h2 id="checklists-title" className="section-title">Inspection checklists</h2>
          <p className="mt-1 text-sm text-zinc-600">Pre-delivery inspection and routine maintenance use an approved checklist for this exact vehicle.</p>
        </div>
      </div>
      <div className="px-5 py-5 sm:px-6">
        {!online && !result.data ? (
          <p role="status" className="border-l-4 border-amber-500 pl-3 text-sm leading-6 text-zinc-700">
            Connect to check whether an approved checklist is available.
          </p>
        ) : result.isPending ? (
          <Loading label="Checking approved inspection lists" />
        ) : result.isError ? (
          <Failure error={result.error} retry={() => void result.refetch()} />
        ) : (
          <>
            {!online && <p role="status" className="mb-4 border-l-4 border-amber-500 bg-amber-50/60 px-3 py-2 text-sm leading-6 text-zinc-800">Offline — showing the last checklist status loaded. Reconnect to refresh approvals before work continues.</p>}
            {result.data.checklists.length > 0 && (
              <ul className="divide-y divide-zinc-200">
                {result.data.checklists.map((checklist) => (
                  <li key={checklist.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                    <div>
                      <p className="text-sm font-semibold text-zinc-900">
                        {checklist.kind === "pdi" ? "Pre-delivery inspection" : "Routine maintenance"}
                      </p>
                      <p className="mt-1 text-xs text-zinc-600">
                        {checklist.odometerAtStartKm === null ? "Mileage not recorded" : `${checklist.odometerAtStartKm.toLocaleString("en-GH")} km`}
                        {" · "}{checklist.scheduleBasis === "unknown" ? "Schedule basis not confirmed" : checklist.scheduleBasis.replaceAll("-", " ")}
                      </p>
                    </div>
                    <span className="rounded-full border border-zinc-300 px-2.5 py-1 text-xs font-medium capitalize text-zinc-700">
                      {checklist.state.replaceAll("-", " ")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {result.data.unavailableReason ? (
              <p role="status" className="border-l-4 border-amber-500 bg-amber-50/60 px-3 py-2 text-sm leading-6 text-zinc-800">
                {result.data.unavailableReason}
              </p>
            ) : result.data.availableTemplates.length > 0 ? (
              <div className="space-y-3">
                <p className="text-sm font-medium text-zinc-800">Approved lists for this vehicle</p>
                {result.data.availableTemplates.map((template) => (
                  <div key={template.id} className="flex flex-wrap items-center justify-between gap-3 border-l-2 border-sky-700 pl-3">
                    <div>
                      <p className="text-sm font-medium text-zinc-900">
                        {template.kind === "pdi" ? "Pre-delivery inspection" : "Routine maintenance"} · {template.code}, revision {template.revision}
                      </p>
                      <p className="mt-1 text-xs text-zinc-600">{template.make} {template.model} · {template.variant} · {template.powertrain}</p>
                    </div>
                    <span className="text-xs text-zinc-600">Starting a checklist is not available yet</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-zinc-600">No inspection checklist has been started for this visit.</p>
            )}
            {result.data.pagination.totalPages > 1 && (
              <nav aria-label="Inspection checklist pages" className="mt-5 flex items-center justify-between border-t border-zinc-200 pt-4">
                <p className="text-xs text-zinc-600">Page {result.data.pagination.page} of {result.data.pagination.totalPages}</p>
                <div className="flex gap-2">
                  <button className="button button-secondary" type="button" disabled={page <= 1} onClick={() => setPage(value => Math.max(1, value - 1))}>Previous</button>
                  <button className="button button-secondary" type="button" disabled={page >= result.data.pagination.totalPages} onClick={() => setPage(value => value + 1)}>Next</button>
                </div>
              </nav>
            )}
            <p className="mt-4 border-t border-zinc-100 pt-3 text-xs leading-5 text-zinc-500">
              Checklist results do not replace repair-task sign-off or vehicle release approval.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
