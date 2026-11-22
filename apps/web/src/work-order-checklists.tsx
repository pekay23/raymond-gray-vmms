import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, request, workOrderChecklistDraftPath, workOrderChecklistDraftResultSchema, workOrderChecklistsPath, workOrderChecklistsSchema } from "./api";
import type { WorkOrder } from "./api";
import { Failure, Loading, useOnline, useToast } from "./ui";

type DraftAttempt = { key: string; id: string; body: { expectedWorkOrderVersion:number; templateRevisionId:string; scheduleBasis:"customer-request"|"unknown" } };

export function WorkOrderChecklists({ order, siteId, canWrite }: { order: WorkOrder; siteId: string; canWrite:boolean }) {
  const online = useOnline();
  const cache=useQueryClient(),notify=useToast();
  const [page, setPage] = useState(1);
  const [scheduleBasis,setScheduleBasis]=useState<"customer-request"|"unknown">("unknown");
  const attempt=useRef<DraftAttempt|null>(null);
  useEffect(() => setPage(1), [order.id]);
  const result = useQuery({
    queryKey: ["work-order-checklists", siteId, order.id, page],
    queryFn: () => request(workOrderChecklistsPath(siteId, order.id, page, 10), workOrderChecklistsSchema),
    enabled: online,
    retry: false,
  });
  const prepare=useMutation({
    mutationFn:({templateRevisionId}:{templateRevisionId:string})=>{
      const body={expectedWorkOrderVersion:order.version,templateRevisionId,scheduleBasis};
      const key=JSON.stringify(body);
      if(!attempt.current||attempt.current.key!==key)attempt.current={key,id:crypto.randomUUID(),body};
      return request(workOrderChecklistDraftPath(siteId,order.id),workOrderChecklistDraftResultSchema,
        {method:"POST",commandId:attempt.current.id,body:attempt.current.body});
    },
    onSuccess:()=>{attempt.current=null;void cache.invalidateQueries({queryKey:["work-order-checklists",siteId,order.id]});notify("Checklist draft prepared. It does not authorize work.");},
    onError:(error)=>{
      if(error instanceof ApiError&&error.status>=400&&error.status<500){
        attempt.current=null;
        if(error.status===409){
          void cache.invalidateQueries({queryKey:["work-order",siteId,order.id]});
          void cache.invalidateQueries({queryKey:["work-order-checklists",siteId,order.id]});
        }
      }
    },
  });

  return (
    <section className="panel" aria-labelledby="checklists-title">
      <div className="panel-heading">
        <div>
          <h2 id="checklists-title" className="section-title">Routine maintenance</h2>
          <p className="mt-1 text-sm text-zinc-600">VMMS uses a current approved checklist for this exact vehicle. The 10,000 km or 12-month reminder does not decide which work to perform.</p>
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
                        {checklist.templateCode}, revision {checklist.templateRevision}
                      </p>
                      <p className="mt-1 text-xs text-zinc-600">
                        {checklist.odometerAtStartKm === null ? "Mileage not recorded" : `${checklist.odometerAtStartKm.toLocaleString("en-GH")} km`}
                        {" · "}{checklist.scheduleBasis === "unknown" ? "Schedule basis not confirmed" : checklist.scheduleBasis.replaceAll("-", " ")}
                      </p>
                    </div>
                    <span className="rounded-full border border-zinc-300 px-2.5 py-1 text-xs font-medium capitalize text-zinc-700">{checklist.state.replaceAll("-", " ")}</span>
                    <Link className="button button-secondary" to={`/sites/${encodeURIComponent(siteId)}/work-orders/${encodeURIComponent(order.id)}/checklists/${encodeURIComponent(checklist.id)}/report`}>Open report</Link>
                    {checklist.state === "draft" && <p role="status" className="w-full border-l-4 border-amber-500 bg-amber-50/60 px-3 py-2 text-sm leading-6 text-amber-950">Draft only. VMMS cannot start this checklist yet. It does not authorize or direct inspection or repair work.</p>}
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
                <p className="text-sm font-medium text-zinc-800">Approved routine maintenance lists for this vehicle</p>
                <label className="block max-w-sm text-sm font-medium text-zinc-800" htmlFor="maintenance-schedule-basis">Why is maintenance being requested?
                  <select id="maintenance-schedule-basis" className="mt-1 block w-full" value={scheduleBasis} onChange={event=>setScheduleBasis(event.target.value==="customer-request"?"customer-request":"unknown")} disabled={prepare.isPending||!online}>
                    <option value="unknown">Service history or schedule not confirmed</option>
                    <option value="customer-request">Customer requested routine maintenance</option>
                  </select>
                </label>
                <p className="border-l-4 border-amber-500 bg-amber-50/60 px-3 py-2 text-sm leading-6 text-zinc-800">Preparing a draft does not record customer consent or authorize inspection or repair. Those steps must be approved separately.</p>
                {!canWrite&&<p role="status" className="text-sm text-zinc-600">This account has read-only access and cannot prepare a checklist.</p>}
                {canWrite&&!result.data.canPrepare&&<p role="status" className="text-sm text-zinc-600">A current checklist-preparation authority grant is required.</p>}
                {prepare.isError&&<p role="alert" className="text-sm text-red-800">{prepare.error.message}</p>}
                {result.data.availableTemplates.map((template) => (
                  <div key={template.id} className="flex flex-wrap items-center justify-between gap-3 border-l-2 border-sky-700 pl-3">
                    <div>
                      <p className="text-sm font-medium text-zinc-900">
                        {template.code}, revision {template.revision}
                      </p>
                      <p className="mt-1 text-xs text-zinc-600">{template.make} {template.model} · {template.variant} · {template.powertrain}</p>
                    </div>
                    {result.data.checklists.some(checklist=>checklist.templateRevisionId===template.id)?
                      <span className="text-xs text-zinc-600">A checklist already exists for this revision</span>:
                      canWrite&&result.data.canPrepare&&<button className="button button-secondary" type="button" disabled={!online||prepare.isPending} onClick={()=>prepare.mutate({templateRevisionId:template.id})}>{prepare.isPending?"Preparing…":"Prepare draft"}</button>}
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
