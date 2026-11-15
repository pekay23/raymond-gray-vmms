import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, UserRoundPlus } from "lucide-react";
import { z } from "zod";
import {
  ApiError,
  request,
  sitePath,
  staffAccountProvisioningRequestSchema,
  staffAccountProvisioningRequestsSchema,
} from "../api";
import { useStaff } from "../workspace";
import { Badge, Button, Empty, Failure, FormError, Loading, PageHeading, dateTime, useOnline, useToast } from "../ui";

const queuedRequestSchema=staffAccountProvisioningRequestSchema;
const inputSchema=z.object({
  email:z.email(),
  displayName:z.string().trim().min(1).max(120),
  siteAccess:z.enum(["read-only","write-enabled"]),
  reason:z.string().trim().min(1).max(500),
}).strict();
type AccountRequestInput=z.infer<typeof inputSchema>;

const statusLabels:Record<z.infer<typeof queuedRequestSchema>["state"],string>={
  queued:"Waiting for identity setup",
  provisioning:"Setting up sign-in",
  "invitation-issued":"Invitation sent",
  active:"Account active",
  suspended:"Account suspended",
  failed:"Setup needs review",
};

export function StaffAccounts(){
  const {site}=useStaff();
  const online=useOnline();
  const client=useQueryClient();
  const toast=useToast();
  const [page,setPage]=useState(1);
  const [email,setEmail]=useState("");
  const [displayName,setDisplayName]=useState("");
  const [siteAccess,setSiteAccess]=useState<AccountRequestInput["siteAccess"]>("read-only");
  const [reason,setReason]=useState("");
  const [error,setError]=useState<unknown>(null);
  const attempt=useRef<{key:string;payload:string}|null>(null);
  const path=`${sitePath(site.id)}/staff/account-provisioning-requests`;
  const requests=useQuery({
    queryKey:["staff-account-requests",site.id,page],
    queryFn:()=>request(`${path}?page=${page}&pageSize=25`,staffAccountProvisioningRequestsSchema),
    enabled:online,
    retry:false,
  });
  const create=useMutation({
    mutationFn:(body:AccountRequestInput)=>{
      const serialized=JSON.stringify(body);
      if(!attempt.current||attempt.current.payload!==serialized)
        attempt.current={key:crypto.randomUUID(),payload:serialized};
      return request(path,queuedRequestSchema,{method:"POST",commandId:attempt.current.key,body});
    },
    onSuccess:async()=>{
      attempt.current=null;
      setEmail("");setDisplayName("");setSiteAccess("read-only");setReason("");setError(null);
      toast("Account request saved. No sign-in invitation has been sent.");
      await client.invalidateQueries({queryKey:["staff-account-requests",site.id]});
    },
    onError:(problem)=>setError(problem),
  });

  function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    setError(null);
    const parsed=inputSchema.safeParse({email:email.trim(),displayName,siteAccess,reason});
    if(!parsed.success){setError(new Error("Add a valid email, staff name, access level, and reason."));return;}
    create.mutate(parsed.data);
  }

  if(requests.isPending&&!requests.data&&online)return <Loading label="Loading account requests"/>;
  if(requests.isError&&requests.error instanceof ApiError&&requests.error.status===403){
    return <section className="panel max-w-2xl border-l-2 border-l-zinc-500 p-6" aria-labelledby="accounts-restricted">
      <p className="text-xs font-semibold uppercase text-zinc-500">Account access</p>
      <h1 id="accounts-restricted" className="mt-2 text-xl font-semibold text-zinc-950">This section is for the VMMS Operator</h1>
      <p className="mt-2 text-sm text-zinc-600">Ask the VMMS Operator if you need an account or site access. This does not change your work role.</p>
    </section>;
  }
  if(requests.isError&&!requests.data)return <Failure error={requests.error} retry={()=>void requests.refetch()}/>;

  const data=requests.data;
  const canSubmit=online&&site.canWrite&&!create.isPending;
  return <>
    <PageHeading eyebrow="Account access" title="Staff account requests">
      Request a staff sign-in and access to this site. Work roles are assigned separately by the Head of Service Centre.
    </PageHeading>

    <div role="status" className="mb-6 border-l-2 border-l-amber-600 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950">
      These requests are stored in VMMS while the shared sign-in service is being connected. No account or invitation is created yet.
    </div>
    {!online&&<div role="status" className="mb-6 border-l-2 border-l-amber-600 bg-amber-50 px-4 py-3 text-sm text-amber-950">{data?"You are offline. This list was loaded earlier in this tab and may be out of date; it is not saved on this device.":"Connect to submit an account request. Entries stay in this open tab and are not saved offline."}</div>}
    {!site.canWrite&&<div role="status" className="mb-6 border-l-2 border-l-zinc-500 bg-zinc-100 px-4 py-3 text-sm text-zinc-700">This account has read-only access at this site.</div>}

    <section className="panel mb-8" aria-labelledby="new-staff-request">
      <div className="panel-heading">
        <div>
          <h2 id="new-staff-request" className="section-title">Request an account</h2>
          <p className="mt-1 text-sm text-zinc-500">This request does not assign a workshop role or send an email.</p>
        </div>
      </div>
      <form onSubmit={submit} className="space-y-5 p-5 sm:p-6">
        <fieldset disabled={!canSubmit} className="grid min-w-0 gap-5 sm:grid-cols-2">
          <div className="min-w-0">
            <label htmlFor="staff-account-name">Staff name</label>
            <input id="staff-account-name" name="displayName" autoComplete="name" maxLength={120} required value={displayName} onChange={event=>setDisplayName(event.target.value)}/>
          </div>
          <div className="min-w-0">
            <label htmlFor="staff-account-email">Email for sign-in setup</label>
            <input id="staff-account-email" name="email" type="email" autoComplete="email" maxLength={254} required value={email} onChange={event=>setEmail(event.target.value)}/>
          </div>
          <div className="min-w-0">
            <label htmlFor="staff-account-access">Site access</label>
            <select id="staff-account-access" name="siteAccess" value={siteAccess} onChange={event=>setSiteAccess(event.target.value as AccountRequestInput["siteAccess"])}>
              <option value="read-only">Read-only access</option>
              <option value="write-enabled">Access to make changes</option>
            </select>
            <p className="mt-2 text-xs leading-5 text-zinc-500">Work actions still require the right role and approval.</p>
          </div>
          <div className="min-w-0 sm:col-span-2">
            <label htmlFor="staff-account-reason">Reason for this request</label>
            <textarea id="staff-account-reason" name="reason" maxLength={500} required value={reason} onChange={event=>setReason(event.target.value)} placeholder="For example, new service advisor at this site"/>
          </div>
        </fieldset>
        <FormError error={error}/>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={!canSubmit}>
            <UserRoundPlus className="size-4" aria-hidden="true"/>
            {create.isPending?"Saving request…":"Save account request"}
          </Button>
          {data&&<p className="text-sm text-zinc-500">{data.totalCount} {data.totalCount===1?"request":"requests"} on record</p>}
        </div>
      </form>
    </section>

    {requests.isError&&<div className="mb-6"><Failure error={requests.error} retry={()=>void requests.refetch()}/></div>}
    <section aria-labelledby="staff-account-requests-title">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="staff-account-requests-title" className="section-title">Requests for this site</h2>
          <p className="mt-1 text-sm text-zinc-500">Only Operators with access to this site can view these requests.</p>
        </div>
        {data&&data.totalPages>0&&<p className="text-sm text-zinc-500">Page {data.page} of {data.totalPages}</p>}
      </div>
      {!online&&!data?<div role="status" className="panel border-l-2 border-l-amber-600 p-5 text-sm leading-6 text-zinc-700">Connect to view account requests. This list is not saved on this device.</div>:!data?.requests.length?<Empty title="No account requests yet">New requests will appear here after you save them.</Empty>:<ul className="grid gap-3" aria-label="Staff account requests">
        {data.requests.map(item=><li key={item.id} className="panel min-w-0 border-l-2 border-l-sky-700 p-4 sm:p-5">
          <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="break-words text-base font-semibold text-zinc-900">{item.displayName}</h3>
              <p className="mt-1 break-all text-sm text-zinc-600">{item.email}</p>
            </div>
            <Badge tone={item.state==="failed"?"danger":item.state==="queued"?"warning":item.state==="active"?"green":"neutral"}>{statusLabels[item.state]}</Badge>
          </div>
          <div className="mt-4 flex min-w-0 flex-wrap gap-x-5 gap-y-2 border-t border-zinc-100 pt-3 text-sm text-zinc-600">
            <span>{item.siteAccess==="read-only"?"Read-only site access":"Can make changes at this site"}</span>
            <span>Requested {dateTime(item.createdAt, site.timeZone)}</span>
          </div>
        </li>)}
      </ul>}
      {data&&data.totalPages>1&&<nav className="mt-5 flex flex-wrap items-center justify-between gap-3" aria-label="Account request pages">
        <Button type="button" variant="secondary" disabled={page<=1} onClick={()=>setPage(value=>Math.max(1,value-1))}><ArrowLeft className="size-4" aria-hidden="true"/>Previous page</Button>
        <Button type="button" variant="secondary" disabled={page>=data.totalPages} onClick={()=>setPage(value=>Math.min(data.totalPages,value+1))}>Next page<ArrowRight className="size-4" aria-hidden="true"/></Button>
      </nav>}
    </section>
  </>;
}
