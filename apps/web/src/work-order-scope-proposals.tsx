import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { request, payerScopeResponseInputSchema, payerScopeResponsePath, payerScopeResponseResultSchema, scopeProposalPageSchema, scopeProposalResultSchema, scopeProposalsPath } from './api';
import type { WorkOrder } from './api';
import { ApiError } from './api';
import { Button, Failure, Loading, useOnline, useToast } from './ui';
import { useStaff } from './workspace';
import { formatCurrencyMinorUnits, parseCurrencyAmountToMinorUnits } from './formatting';

export function WorkOrderScopeProposals({order,refresh}:{order:WorkOrder;refresh:()=>void}) {
  const {site}=useStaff();
  const online=useOnline();
  const client=useQueryClient();
  const notify=useToast();
  const [requestedKind,setRequestedKind]=useState<'diagnosis'|'repair'>('repair');
  const [taskIds,setTaskIds]=useState<string[]>([]);
  const [rationale,setRationale]=useState('');
  const [estimateAmount,setEstimateAmount]=useState('');
  const [estimateCurrency,setEstimateCurrency]=useState('GHS');
  const [proposalFormError,setProposalFormError]=useState('');
  const [responseMethods,setResponseMethods]=useState<Record<string,'phone'|'written'>>({});
  const [responseFormErrors,setResponseFormErrors]=useState<Record<string,string>>({});
  const attempt=useRef<{id:string;content:string;body:Record<string,unknown>}|null>(null);
  const responseAttempts=useRef<Record<string,{id:string;content:string;body:Record<string,unknown>}>>({});
  const query=useQuery({
    queryKey:['work-order-scope-proposals',site.id,order.id],
    queryFn:()=>request(scopeProposalsPath(site.id,order.id),scopeProposalPageSchema),
    enabled:online,
    retry:false,
  });
  const mutation=useMutation({
    mutationFn:(input:{requestedKind:'diagnosis'|'repair';taskIds:string[];rationale:string;estimate:{minorUnits:string;currency:string}|null})=>{
      const content=JSON.stringify(input);
      if(!attempt.current||attempt.current.content!==content) attempt.current={
        id:crypto.randomUUID(),content,body:{...input,expectedVersion:order.version},
      };
      return request(scopeProposalsPath(site.id,order.id),scopeProposalResultSchema,{method:'POST',commandId:attempt.current.id,body:attempt.current.body});
    },
    onSuccess:()=>{
      attempt.current=null;
      setRationale('');
      setEstimateAmount('');
      setProposalFormError('');
      setTaskIds([]);
      notify('Draft scope proposal saved. No work has been approved.');
      void client.invalidateQueries({queryKey:['work-order-scope-proposals',site.id,order.id]});
      void client.invalidateQueries({queryKey:['work-order',site.id,order.id]});
      void client.invalidateQueries({queryKey:['work-orders',site.id]});
      refresh();
    },
    onError:error=>{
      if(error instanceof ApiError&&error.status===409){
        attempt.current=null;
        void client.invalidateQueries({queryKey:['work-order',site.id,order.id]});
        void client.invalidateQueries({queryKey:['work-order-scope-proposals',site.id,order.id]});
      }
    },
  });
  const responseMutation=useMutation({
    mutationFn:({proposalId,body}:{proposalId:string;body:Record<string,unknown>})=>{
      const parsed=payerScopeResponseInputSchema.parse(body);
      const content=JSON.stringify(parsed);
      let attemptForProposal=responseAttempts.current[proposalId];
      if(!attemptForProposal||attemptForProposal.content!==content) attemptForProposal={id:crypto.randomUUID(),content,body:parsed};
      responseAttempts.current[proposalId]=attemptForProposal;
      return request(payerScopeResponsePath(site.id,order.id,proposalId),payerScopeResponseResultSchema,
        {method:'POST',commandId:attemptForProposal.id,body:attemptForProposal.body});
    },
    onSuccess:async result=>{
      delete responseAttempts.current[result.scopeRevisionId];
      notify(result.response.decision==='approved'
        ?'Payer response recorded. Technical and procedure checks still block work.'
        :'Payer declined the proposed scope. No work has been approved.');
      await Promise.all([
        client.invalidateQueries({queryKey:['work-order-scope-proposals',site.id,order.id]}),
        client.invalidateQueries({queryKey:['work-order',site.id,order.id]}),
        client.invalidateQueries({queryKey:['work-orders',site.id]}),
      ]);
      refresh();
    },
    onError:error=>{
      if(error instanceof ApiError&&error.status===409){
        void client.invalidateQueries({queryKey:['work-order',site.id,order.id]});
        void client.invalidateQueries({queryKey:['work-order-scope-proposals',site.id,order.id]});
      }
    },
  });

  function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    try {
      const estimate=requestedKind==='repair'?{minorUnits:parseCurrencyAmountToMinorUnits(estimateAmount,estimateCurrency),currency:estimateCurrency}:null;
      if(estimate&&BigInt(estimate.minorUnits)===0n) throw new RangeError('Enter a positive estimate for repair work.');
      setProposalFormError('');
      mutation.mutate({requestedKind,taskIds,rationale:rationale.trim(),estimate});
    } catch(error) {
      setProposalFormError(error instanceof Error?error.message:'Check the estimate amount and currency.');
    }
  }
  function toggleTask(id:string,checked:boolean){
    setTaskIds(current=>checked?[...current,id]:current.filter(item=>item!==id));
  }
  return <section className="panel mb-6 border-l-4 border-l-amber-500" aria-labelledby="scope-proposals-title">
    <div className="panel-heading"><div><h2 id="scope-proposals-title" className="section-title">Proposed work scope</h2><p className="mt-1 text-sm text-zinc-600">Record the exact tasks being considered for approval.</p></div></div>
    <div className="space-y-5 p-5 sm:p-6">
      <p role="note" className="border-l-4 border-amber-500 bg-amber-50/60 px-3 py-2 text-sm leading-6 text-zinc-800">
        A draft proposal is not customer consent or permission to begin work. Diagnostic consent does not authorize repairs, parts, or added costs.
      </p>
      {!online&&!query.data?<p role="status" className="text-sm text-amber-800">Connect to load this job’s scope proposals.</p>
      :query.isPending?<Loading label="Loading scope proposals"/>
      :query.isError?<Failure error={query.error} retry={()=>void query.refetch()}/>
      :<>
        {!query.data.canPrepare&&<p role="status" className="text-sm text-amber-800">{query.data.blockReason==='read-only'?'Your account can view, but not change, this job.':'A current scope-proposal permission is required. Ask the authorized manager to review access.'}</p>}
        {query.data.proposals.length>0&&<ol className="space-y-3" aria-label="Scope proposal history">
          {query.data.proposals.map(proposal=><li key={proposal.id} className="rounded-lg border border-zinc-200 border-l-4 border-l-amber-500 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold text-zinc-900">Draft {proposal.revision} · {proposal.requestedKind==='diagnosis'?'Diagnosis':'Repair'}</h3><span className="rounded-full border border-amber-300 px-2.5 py-1 text-xs font-medium text-amber-900">{proposal.payerResponse
              ?proposal.requestedKind==='diagnosis'&&proposal.payerResponse.decision==='approved'?'Diagnosis consent recorded · checks remain'
                :proposal.requestedKind==='diagnosis'?'Diagnosis declined'
                  :proposal.payerResponse.decision==='approved'?'Payer response recorded · work blocked':'Scope declined'
              :'Not approved'}</span></div>
            <p className="mt-2 text-sm text-zinc-700">{proposal.rationale}</p>
            {proposal.estimate&&<p className="mt-2 text-sm font-medium text-zinc-900">Proposed estimate: {formatCurrencyMinorUnits(proposal.estimate.minorUnits,proposal.estimate.currency)}</p>}
            {proposal.requestedKind==='repair'&&!proposal.estimate&&<p role="status" className="mt-2 border-l-4 border-amber-500 bg-amber-50/60 px-3 py-2 text-sm text-amber-900">Add a current estimate in a new proposal before asking the payer to approve repair work.</p>}
            <ul className="mt-2 space-y-1 text-sm text-zinc-600">{proposal.tasks.map(task=><li key={task.id}><span className="font-mono">{task.reference}</span> · {task.title}</li>)}</ul>
            <p className="mt-2 text-xs text-zinc-500">Prepared by {proposal.preparedBy} · Work-order version {proposal.sourceWorkOrderVersion}</p>
            {proposal.payerResponse?<div className="mt-4 rounded-md border border-blue-200 bg-blue-50/60 p-3 text-sm">
              <p className="font-semibold text-blue-950">{proposal.requestedKind==='diagnosis'
                ?`Payer ${proposal.payerResponse.decision==='approved'?'agreed to diagnosis only':'declined diagnosis'}`
                :`Payer ${proposal.payerResponse.decision==='approved'?'agreed to':'declined'} this proposed scope`}</p>
              <p className="mt-1 text-blue-900">Recorded by {proposal.payerResponse.recordedBy} · {new Date(proposal.payerResponse.recordedAt).toLocaleString()}</p>
              <p className="mt-1 text-blue-900">Respondent: {proposal.payerResponse.respondentName} ({proposal.payerResponse.respondentRelationship==='payer'?'paying client':'authorised representative'})</p>
              <p className="mt-1 text-blue-900">Response received by {proposal.payerResponse.responseMethod==='phone'?'phone':'written record'}</p>
              {proposal.payerResponse.evidenceIds.length>0&&<ul className="mt-2 list-inside list-disc text-blue-900">{proposal.payerResponse.evidenceIds.map(id=><li key={id}>{order.evidence.find(item=>item.evidenceId===id)?.displayName??'Attached written evidence'}</li>)}</ul>}
              <p className="mt-2 text-blue-950">{proposal.payerResponse.responseSummary}</p>
              <p className="mt-2 border-t border-blue-200 pt-2 font-medium text-blue-950">{proposal.requestedKind==='diagnosis'
                ?'This records diagnosis consent only. It does not authorize diagnostic work, repairs, parts, charges, or dispatch. Required price and technical reviews must still pass.'
                :'This records agreement to the listed work and estimate only. It does not authorize repair. Effective procedures, technical review, qualifications, and authority checks still block work.'}</p>
            </div>:query.data.canRecordPayerResponse&&proposal.canRespond?<form className="mt-4 space-y-3 rounded-md border border-zinc-200 bg-zinc-50/60 p-3" onSubmit={event=>{
              event.preventDefault();
              const form=new FormData(event.currentTarget);
              const parsed=payerScopeResponseInputSchema.safeParse({
                expectedWorkOrderVersion:query.data.workOrderVersion,scopeRevisionId:proposal.id,scopeDigest:proposal.scopeDigest,
                decision:form.get('decision'),respondentName:form.get('respondentName'),respondentRelationship:form.get('respondentRelationship'),
                responseMethod:form.get('responseMethod'),evidenceIds:form.getAll('evidenceIds').map(String),
                writtenEvidenceConfirmed:form.get('writtenEvidenceConfirmed')==='on',
                authorityBasis:form.get('authorityBasis'),identityCheckSummary:form.get('identityCheckSummary'),scopeReadBack:form.get('scopeReadBack')==='on',responseSummary:form.get('responseSummary'),
              });
              if(parsed.success){setResponseFormErrors(current=>({...current,[proposal.id]:''}));responseMutation.mutate({proposalId:proposal.id,body:parsed.data});}
              else setResponseFormErrors(current=>({...current,[proposal.id]:parsed.error.issues[0]?.message??'Check the response details and try again.'}));
            }}>
              <h4 className="text-sm font-semibold text-zinc-900">Record the payer’s response</h4>
              <p className="text-xs leading-5 text-zinc-600">Read back the exact listed tasks{proposal.estimate?` and ${formatCurrencyMinorUnits(proposal.estimate.minorUnits,proposal.estimate.currency)} estimate`:''}. This records the payer’s response only; technical approval is still required before work.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm font-medium text-zinc-800">How was the response received?
                  <select className="mt-1 block w-full" name="responseMethod" value={responseMethods[proposal.id]??'phone'} onChange={event=>{setResponseFormErrors(current=>({...current,[proposal.id]:''}));setResponseMethods(current=>({...current,[proposal.id]:event.target.value as 'phone'|'written'}));}} disabled={!online||responseMutation.isPending}>
                    <option value="phone">Phone call</option><option value="written">Written response</option>
                  </select>
                </label>
                <label className="block text-sm font-medium text-zinc-800">Response
                  <select className="mt-1 block w-full" name="decision" defaultValue="approved" disabled={!online||responseMutation.isPending}>
                    <option value="approved">{proposal.requestedKind==='diagnosis'?'Payer agreed to diagnosis only':'Payer agreed to this scope'}</option><option value="declined">{proposal.requestedKind==='diagnosis'?'Payer declined diagnosis':'Payer declined this scope'}</option>
                  </select>
                </label>
                <label className="block text-sm font-medium text-zinc-800">Person spoken to
                  <input className="mt-1 block w-full" name="respondentName" required maxLength={180} disabled={!online||responseMutation.isPending}/>
                </label>
                <label className="block text-sm font-medium text-zinc-800">Their role
                  <select className="mt-1 block w-full" name="respondentRelationship" defaultValue="payer" disabled={!online||responseMutation.isPending}>
                    <option value="payer">Paying client</option><option value="authorised-representative">Authorised representative</option>
                  </select>
                </label>
                <label className="block text-sm font-medium text-zinc-800">How their authority was checked
                  <input className="mt-1 block w-full" name="authorityBasis" required maxLength={1000} disabled={!online||responseMutation.isPending}/>
                </label>
              </div>
              <label className="block text-sm font-medium text-zinc-800">How the person was identified
                <textarea className="mt-1 block w-full" name="identityCheckSummary" required rows={2} maxLength={1000} disabled={!online||responseMutation.isPending}/>
              </label>
              <label className="flex items-start gap-2 text-sm text-zinc-800">
                <input className="mt-1" name="scopeReadBack" type="checkbox" required disabled={!online||responseMutation.isPending}/>
                <span>I read back the exact tasks{proposal.estimate?` and the ${formatCurrencyMinorUnits(proposal.estimate.minorUnits,proposal.estimate.currency)} estimate`:''} and recorded the person’s response.</span>
              </label>
              <label className="block text-sm font-medium text-zinc-800">Response notes
                <textarea className="mt-1 block w-full" name="responseSummary" required rows={2} maxLength={1200} disabled={!online||responseMutation.isPending}/>
              </label>
              {(responseMethods[proposal.id]??'phone')==='written'&&<fieldset className="space-y-2 rounded-md border border-zinc-200 p-3">
                <legend className="px-1 text-sm font-semibold text-zinc-900">Written response evidence (required for a written response)</legend>
                {order.evidence.filter(item=>item.attachedAt&&item.state==='accepted').length===0
                  ?<p className="text-sm text-zinc-600">Upload and attach the written response to this job, then wait for its security check to finish.</p>
                  :order.evidence.filter(item=>item.attachedAt&&item.state==='accepted').map(item=><label key={item.evidenceId} className="flex items-start gap-2 text-sm text-zinc-800">
                    <input type="checkbox" name="evidenceIds" value={item.evidenceId} disabled={!online||responseMutation.isPending}/><span>{item.displayName}</span>
                  </label>)}
                <p className="text-xs text-zinc-600">Only files that passed the security scan and are attached to this job can be linked.</p>
                <label className="flex items-start gap-2 border-t border-zinc-200 pt-2 text-sm text-zinc-800"><input className="mt-1" type="checkbox" name="writtenEvidenceConfirmed" required disabled={!online||responseMutation.isPending}/><span>I checked that the file records the payer’s response to this exact scope{proposal.estimate?' and stated estimate':''}.</span></label>
              </fieldset>}
              {(responseFormErrors[proposal.id]||responseMutation.error)&&<p role="alert" className="text-sm text-red-800">{responseFormErrors[proposal.id]|| (responseMutation.error instanceof Error?responseMutation.error.message:'The response could not be saved. Refresh this job before trying again.')}</p>}
              <Button type="submit" variant="secondary" disabled={!online||responseMutation.isPending}>{responseMutation.isPending?'Saving response…':'Save payer response'}</Button>
            </form>:null}
          </li>)}
        </ol>}
        {query.data.plannedTasks.length===0?<p className="text-sm text-zinc-600">Add proposed tasks to this job before preparing a scope proposal.</p>
        :query.data.canPrepare&&<form onSubmit={submit} className="space-y-4 border-t border-zinc-100 pt-5">
          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold text-zinc-900">What kind of work is being proposed?</legend>
            <div className="flex flex-wrap gap-4 text-sm"><label className="flex items-center gap-2"><input type="radio" name="scope-kind" value="diagnosis" checked={requestedKind==='diagnosis'} onChange={()=>setRequestedKind('diagnosis')}/>Diagnosis</label><label className="flex items-center gap-2"><input type="radio" name="scope-kind" value="repair" checked={requestedKind==='repair'} onChange={()=>setRequestedKind('repair')}/>Repair</label></div>
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold text-zinc-900">Choose the planned tasks</legend>
            {query.data.plannedTasks.map(task=><label key={task.id} className="flex items-start gap-3 rounded-md border border-zinc-200 p-3 text-sm"><input type="checkbox" checked={taskIds.includes(task.id)} onChange={event=>toggleTask(task.id,event.target.checked)} className="mt-1"/><span><span className="font-mono text-zinc-500">{task.reference}</span> · {task.title}</span></label>)}
          </fieldset>
          {requestedKind==='repair'&&<div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem]">
            <label className="block text-sm font-medium text-zinc-800">Estimated amount
              <input className="mt-1 block w-full" inputMode="decimal" autoComplete="off" value={estimateAmount} onChange={event=>{setEstimateAmount(event.target.value);setProposalFormError('');}} placeholder="0.00" aria-describedby="scope-estimate-help" required/>
            </label>
            <label className="block text-sm font-medium text-zinc-800">Currency code
              <input className="mt-1 block w-full uppercase" autoComplete="off" maxLength={3} value={estimateCurrency} onChange={event=>{setEstimateCurrency(event.target.value.toUpperCase());setProposalFormError('');}} required/>
            </label>
            <p id="scope-estimate-help" className="field-hint sm:col-span-2">Enter the amount you will read to the paying client. VMMS stores it exactly; it does not add tax, calculate an invoice, or authorize repair.</p>
          </div>}
          <div><label htmlFor="scope-proposal-rationale">Reason for this proposal</label><textarea id="scope-proposal-rationale" rows={3} maxLength={1000} required value={rationale} onChange={event=>setRationale(event.target.value)} aria-describedby="scope-proposal-help"/><p id="scope-proposal-help" className="field-hint">Explain the proposed work. Put the estimated amount in its separate field above.</p></div>
          {(proposalFormError||mutation.error)&&<p role="alert" className="text-sm text-red-800">{proposalFormError||(mutation.error instanceof Error?mutation.error.message:'The proposal could not be saved. Refresh and try again.')}</p>}
          <Button type="submit" disabled={!online||mutation.isPending||taskIds.length===0}>{mutation.isPending?'Saving proposal…':'Save draft proposal'}</Button>
        </form>}
        {!online&&<p role="status" className="text-sm text-amber-800">Offline — proposals cannot be saved until you reconnect.</p>}
      </>}
    </div>
  </section>;
}

