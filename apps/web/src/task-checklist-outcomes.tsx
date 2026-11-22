import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { ApiError, myTaskWorkEvidencePath, request, taskWorkEvidenceOptionsSchema } from "./api";
import { Button, Failure, Loading, useOnline } from "./ui";

const id = z.string().uuid();
const taskChecklistsSchema = z.object({
  workOrderId:id, taskId:id, workPlanRevisionId:id, assignmentRevision:z.number().int().positive(),
  checklists:z.array(z.object({id,state:z.enum(["draft","in-progress","submitted","returned","approved","closed"]),version:z.number().int().positive(),templateCode:z.string(),templateRevision:z.number().int().positive(),items:z.array(z.object({id,code:z.string(),definition:z.record(z.string(),z.unknown())}).strict())}).strict()),
}).strict();
const outcomeSchema = z.object({id,revision:z.number().int().positive(),result:z.enum(["completed","failed","not-checked","not-completed","blocked","not-applicable"]),reason:z.string().nullable(),applicabilityReason:z.string().nullable(),comments:z.string().nullable(),measurement:z.object({field:z.string(),value:z.string(),unit:z.string()}).strict().nullable(),evidenceIds:z.array(id),actorName:z.string(),assigneeName:z.string(),recordedAt:z.string()}).passthrough();
const historySchema=z.object({workOrderId:id,taskId:id,checklistId:id,checklistVersion:z.number().int().positive(),sourceTemplateRevisionId:id,itemCode:z.string(),definition:z.record(z.string(),z.unknown()),items:z.array(outcomeSchema),pagination:z.object({page:z.number().int(),pageSize:z.number().int(),totalItems:z.number().int(),totalPages:z.number().int()})}).strict();
const resultSchema=z.object({workOrderId:id,taskId:id,checklistId:id,checklistVersion:z.number().int(),itemId:id,sourceTemplateRevisionId:id,outcome:outcomeSchema}).strict();
const outcomeValues=["completed","failed","not-checked","not-completed","blocked","not-applicable"] as const;
type OutcomeValue=(typeof outcomeValues)[number];
type AssignedTask={workOrderId:string;taskId:string;workPlanRevisionId:string;assignmentRevision:number};
const listPath=(siteId:string,task:AssignedTask)=>`/sites/${encodeURIComponent(siteId)}/my-tasks/${encodeURIComponent(task.workOrderId)}/${encodeURIComponent(task.taskId)}/checklists`;
const outcomePath=(siteId:string,task:AssignedTask,checklistId:string,itemId:string)=>`${listPath(siteId,task)}/${encodeURIComponent(checklistId)}/items/${encodeURIComponent(itemId)}/outcomes`;
const historyPath=(siteId:string,task:AssignedTask,checklistId:string,itemId:string)=>`${outcomePath(siteId,task,checklistId,itemId)}?page=1&pageSize=100`;

export function TaskChecklistOutcomes({task,siteId}:{task:AssignedTask;siteId:string}) {
  const online=useOnline(),cache=useQueryClient();
  const [selected,setSelected]=useState<{checklistId:string;itemId:string}|null>(null);
  const [result,setResult]=useState<OutcomeValue>("not-checked");
  const [reason,setReason]=useState("");
  const [applicabilityReason,setApplicabilityReason]=useState("");
  const [comments,setComments]=useState("");
  const [measurementField,setMeasurementField]=useState("");
  const [measurementValue,setMeasurementValue]=useState("");
  const [measurementUnit,setMeasurementUnit]=useState("");
  const [evidenceIds,setEvidenceIds]=useState<string[]>([]);
  const [correction,setCorrection]=useState<{id:string;reason:string}|null>(null);
  const [message,setMessage]=useState<string|null>(null);
  const attempt=useRef<{fingerprint:string;commandId:string;body:Record<string,unknown>}|null>(null);
  const list=useQuery({queryKey:["my-task-checklists",siteId,task.workOrderId,task.taskId,task.assignmentRevision],queryFn:()=>request(listPath(siteId,task),taskChecklistsSchema),enabled:online,retry:false});
  const evidence=useQuery({queryKey:["my-task-work-evidence",siteId,task.workOrderId,task.taskId,task.assignmentRevision,1],queryFn:()=>request(myTaskWorkEvidencePath(siteId,task.workOrderId,task.taskId,1,50),taskWorkEvidenceOptionsSchema),enabled:online,retry:false});
  const history=useQuery({queryKey:["my-task-checklist-outcomes",siteId,task.workOrderId,task.taskId,selected?.checklistId,selected?.itemId,task.assignmentRevision],queryFn:()=>request(historyPath(siteId,task,selected!.checklistId,selected!.itemId),historySchema),enabled:online&&Boolean(selected),retry:false});
  const checklist=list.data?.checklists.find(item=>item.id===selected?.checklistId);
  const save=useMutation({mutationFn:()=>{
    if(!selected||!checklist)throw new Error("Select a checklist item first.");
    const body={expectedChecklistVersion:checklist.version,expectedWorkPlanRevisionId:task.workPlanRevisionId,expectedAssignmentRevision:task.assignmentRevision,result,
      reason:result==="completed"?null:reason.trim()||null,applicabilityReason:result==="not-applicable"?applicabilityReason.trim()||null:null,
      comments:comments.trim()||null,measurement:measurementValue.trim()?{field:measurementField.trim(),value:measurementValue.trim(),unit:measurementUnit.trim()}:null,
      evidenceIds,supersedesRevisionId:correction?.id??null,correctionReason:correction?.reason.trim()||null};
    const fingerprint=JSON.stringify([selected,body]);
    if(attempt.current?.fingerprint!==fingerprint)attempt.current={fingerprint,commandId:crypto.randomUUID(),body};
    return request(outcomePath(siteId,task,selected.checklistId,selected.itemId),resultSchema,{method:"POST",commandId:attempt.current.commandId,body:attempt.current.body});
  },onSuccess:async()=>{
    attempt.current=null;setCorrection(null);setReason("");setApplicabilityReason("");setComments("");setMeasurementField("");setMeasurementValue("");setMeasurementUnit("");setEvidenceIds([]);setMessage("Checklist outcome saved. The task remains subject to separate review and release.");
    await Promise.all([cache.invalidateQueries({queryKey:["my-task-checklists",siteId,task.workOrderId,task.taskId]}),cache.invalidateQueries({queryKey:["my-task-checklist-outcomes",siteId,task.workOrderId,task.taskId,selected?.checklistId,selected?.itemId]} )]);
  },onError:error=>{if(error instanceof ApiError&&error.status>=400&&error.status<500&&error.status!==408)attempt.current=null;setMessage(error instanceof Error?error.message:"The checklist outcome could not be confirmed. Retry the saved submission.");}});
  const retryRequired=save.isError&&Boolean(attempt.current);
  useEffect(()=>{setSelected(null);setCorrection(null);attempt.current=null;},[task.assignmentRevision,task.taskId,task.workOrderId]);
  function choose(checklistId:string,itemId:string){setSelected({checklistId,itemId});setCorrection(null);setResult("not-checked");setReason("");setApplicabilityReason("");setComments("");setMeasurementField("");setMeasurementValue("");setMeasurementUnit("");setEvidenceIds([]);setMessage(null);save.reset();}
  function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();setMessage(null);save.mutate();}
  const label=(value:unknown,fallback:string)=>typeof value==="string"&&value.trim()?value:fallback;
  return <section className="mt-5 border-t border-zinc-200 pt-4" aria-label="Routine maintenance checklist outcomes">
    <h4 className="font-semibold text-zinc-900">Maintenance checklist</h4>
    {!online&&!list.data?<p role="status" className="mt-2 border-l-4 border-amber-500 pl-3 text-sm text-zinc-700">Reconnect to load or record checklist results. Offline entries are not saved.</p>:list.isPending?<Loading label="Loading assigned maintenance checklist"/>:list.isError?<Failure error={list.error} retry={()=>void list.refetch()}/>:list.data.checklists.length===0?<p className="mt-2 text-sm text-zinc-600">No routine maintenance checklist is prepared for this job.</p>:<div className="mt-3 space-y-4">
      {list.data.checklists.map(check=> <section key={check.id} className="rounded-md border border-zinc-200 p-3" aria-label={`${check.templateCode} revision ${check.templateRevision}`}>
        <h5 className="text-sm font-semibold text-zinc-900">{check.templateCode} · revision {check.templateRevision}</h5><p className="mt-1 text-xs text-zinc-600">Checklist state: {check.state.replaceAll("-"," ")} · version {check.version}</p>
        <ul className="mt-3 space-y-2">{check.items.map(entry=>{
          const active=selected?.checklistId===check.id&&selected.itemId===entry.id;
          return <li key={entry.id} className="min-w-0 border-l-2 border-sky-700 pl-3">
            <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><p className="text-sm font-medium text-zinc-900">{label(entry.definition.label,entry.code)}</p><p className="mt-1 whitespace-pre-wrap break-words text-xs text-zinc-600">{label(entry.definition.instruction,typeof entry.definition.description==="string"?entry.definition.description:"")}</p></div><Button variant="secondary" type="button" aria-expanded={active} onClick={()=>active?setSelected(null):choose(check.id,entry.id)}>{active?"Hide item":check.state==="in-progress"?"Record outcome":"View details"}</Button></div>
            {active&&<div className="mt-3 border-t border-zinc-200 pt-3">
              {!online&&!history.data?<p role="status" className="text-sm text-amber-900">Reconnect to load this item’s outcome history.</p>:history.isPending?<Loading label="Loading this item’s outcome history"/>:history.isError?<Failure error={history.error} retry={()=>void history.refetch()}/>:<>
                {history.data.items.length>0&&<div className="mb-3 rounded-md bg-zinc-50 p-3"><p className="text-xs font-semibold text-zinc-700">Latest saved outcome: {history.data.items[0]?.result.replaceAll("-"," ")}</p>{history.data.items[0]?.reason&&<p className="mt-1 whitespace-pre-wrap text-xs text-zinc-700">Reason: {history.data.items[0]?.reason}</p>}<p className="mt-1 text-xs text-zinc-500">{history.data.items[0]?.actorName} · {history.data.items[0]?.recordedAt}</p><ol className="mt-2 space-y-1">{history.data.items.map(row=><li key={row.id} className="text-xs text-zinc-600">Revision {row.revision}: {row.result.replaceAll("-"," ")}{row.correctionReason?` · correction: ${row.correctionReason}`:""}</li>)}</ol>{history.data.pagination.totalItems>history.data.items.length&&<p className="mt-2 text-xs text-zinc-500">Showing the latest {history.data.items.length} of {history.data.pagination.totalItems} outcome revisions.</p>}</div>}
                {check.state!=="in-progress"?<p role="status" className="text-sm text-amber-900">{check.state==="draft"?"Draft only. VMMS cannot start this checklist yet. Do not use it as a work instruction. Contact the Head of Service Centre to complete the procedure and authority setup.":`This checklist is ${check.state.replaceAll("-"," ")} and cannot accept technician outcomes. Contact the assigned lead before continuing.`}</p>:<form className="space-y-3" onSubmit={submit}>
                  <label htmlFor={`checklist-outcome-${selected.itemId}`} className="block text-sm font-medium text-zinc-800">Result<select id={`checklist-outcome-${selected.itemId}`} aria-label="Result" className="mt-1 block w-full" value={result} disabled={save.isPending||retryRequired} onChange={event=>setResult(event.target.value as OutcomeValue)}>{outcomeValues.map(value=><option key={value} value={value}>{value.replaceAll("-"," ")}</option>)}</select></label>
                  {result!=="completed"&&<label className="block text-sm font-medium text-zinc-800">Why was this not completed?<textarea className="mt-1 block w-full" rows={2} maxLength={1200} required value={reason} disabled={save.isPending||retryRequired} onChange={event=>setReason(event.target.value)}/></label>}
                  {result==="not-applicable"&&<label className="block text-sm font-medium text-zinc-800">Why does this item not apply?<textarea className="mt-1 block w-full" rows={2} maxLength={1200} required value={applicabilityReason} disabled={save.isPending||retryRequired} onChange={event=>setApplicabilityReason(event.target.value)}/></label>}
                  <label className="block text-sm font-medium text-zinc-800">Comments<textarea className="mt-1 block w-full" rows={2} maxLength={2400} value={comments} disabled={save.isPending||retryRequired} onChange={event=>setComments(event.target.value)}/></label>
                  <fieldset className="grid gap-2 sm:grid-cols-3"><legend className="text-sm font-medium text-zinc-800">Measurement, when required by the checklist</legend><input aria-label="Measurement field" disabled={save.isPending||retryRequired} className="min-w-0" placeholder="What was measured" value={measurementField} onChange={event=>setMeasurementField(event.target.value)}/><input aria-label="Measurement value" disabled={save.isPending||retryRequired} className="min-w-0" placeholder="Value" value={measurementValue} onChange={event=>setMeasurementValue(event.target.value)}/><input aria-label="Measurement unit" disabled={save.isPending||retryRequired} className="min-w-0" placeholder="Unit" value={measurementUnit} onChange={event=>setMeasurementUnit(event.target.value)}/></fieldset>
                  {!online&&!evidence.data?<p role="status" className="text-xs text-amber-900">Reconnect to load evidence linked to this job.</p>:evidence.isPending?<Loading label="Loading evidence linked to this job"/>:evidence.isError?<Failure error={evidence.error} retry={()=>void evidence.refetch()}/>:evidence.data.items.filter(file=>file.state==="attached").length===0?<p className="text-xs text-zinc-600">No accepted evidence is linked to this job. The server will block saving if this item requires evidence.</p>:<fieldset className="space-y-2"><legend className="text-sm font-medium text-zinc-800">Evidence linked to this job</legend>{evidence.data.items.filter(file=>file.state==="attached").map(file=><label key={file.evidenceId} className="flex items-start gap-2 text-sm text-zinc-700"><input type="checkbox" disabled={save.isPending||retryRequired} checked={evidenceIds.includes(file.evidenceId)} onChange={event=>setEvidenceIds(ids=>event.target.checked?[...ids,file.evidenceId]:ids.filter(id=>id!==file.evidenceId))}/><span className="break-words">{file.displayName}</span></label>)}</fieldset>}
                  {correction&&<label className="block text-sm font-medium text-zinc-800">Why are you correcting this outcome?<textarea className="mt-1 block w-full" rows={2} required maxLength={1200} disabled={save.isPending||retryRequired} value={correction.reason} onChange={event=>setCorrection({...correction,reason:event.target.value})}/></label>}
                  {message&&<p role="status" className="text-sm text-zinc-700">{message}</p>}{save.isError&&<p role="alert" className="text-sm text-red-800">{message}</p>}
                  <div className="flex flex-wrap gap-2"><Button type="submit" disabled={save.isPending||!online||!retryRequired&&(result!=="completed"&&!reason.trim()||result==="not-applicable"&&!applicabilityReason.trim()||Boolean(measurementValue.trim())&&(!measurementField.trim()||!measurementUnit.trim()))}>{save.isPending?"Saving…":retryRequired?"Retry saved outcome":correction?"Save correction":"Save outcome"}</Button>{correction&&<Button variant="secondary" type="button" disabled={save.isPending||retryRequired} onClick={()=>setCorrection(null)}>Cancel correction</Button>}{!correction&&history.data.items.length>0&&<Button variant="secondary" type="button" disabled={save.isPending||retryRequired} onClick={()=>setCorrection({id:history.data!.items[0]!.id,reason:""})}>Correct latest outcome</Button>}</div>
                </form>}
              </>}
            </div>}
          </li>;
        })}</ul>
      </section>)}
      <p className="border-l-4 border-amber-500 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-950">Checklist results are recorded against your current assignment. They do not sign off the job, approve a vehicle release or replace a required review.</p>
    </div>}
  </section>;
}
