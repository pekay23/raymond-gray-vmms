import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, BriefcaseBusiness, UserRoundPlus } from "lucide-react";
import { z } from "zod";
import { ApiError, request, sitePath } from "../api";
import { useStaff } from "../workspace";
import { Button, Empty, Failure, FormError, Loading, PageHeading, useOnline, useToast } from "../ui";

const roleSchema=z.object({code:z.string(),label:z.string(),description:z.string(),assignableByHead:z.boolean()});
const placementSchema=z.object({
  id:z.string().uuid(),staffUserId:z.string().uuid(),displayName:z.string(),username:z.string(),role:roleSchema,
  reportsToPlacementId:z.string().uuid().nullable(),reportsToName:z.string().nullable(),revision:z.number().int().positive(),state:z.enum(["active","ended"]),
});
const organogramSchema=z.object({
  roles:z.array(roleSchema),placements:z.array(placementSchema),
  staff:z.array(z.object({
    id:z.string().uuid(),displayName:z.string(),username:z.string(),roleCodes:z.array(z.string()),
    rolePlacements:z.array(z.object({id:z.string().uuid(),roleCode:z.string(),revision:z.number().int().positive(),state:z.enum(["active","ended"]),reportsToPlacementId:z.string().uuid().nullable(),reportsToName:z.string().nullable()})),
  })),
  page:z.number().int().positive(),pageSize:z.number().int().positive(),totalCount:z.number().int().nonnegative(),totalPages:z.number().int().nonnegative(),
  staffTotalCount:z.number().int().nonnegative(),staffTotalPages:z.number().int().nonnegative(),
});
type Placement=z.infer<typeof placementSchema>;
const resultSchema=placementSchema;

export function Workforce() {
  const {site}=useStaff();
  const online=useOnline();
  const client=useQueryClient();
  const toast=useToast();
  const [page,setPage]=useState(1);
  const [staffUserId,setStaffUserId]=useState("");
  const [roleCode,setRoleCode]=useState("");
  const [reportsToPlacementId,setReportsToPlacementId]=useState("");
  const [reason,setReason]=useState("");
  const [error,setError]=useState<unknown>(null);
  const [endTarget,setEndTarget]=useState<Placement|null>(null);
  const assignmentAttempt=useRef<{key:string;body:string}|null>(null);
  const endAttempt=useRef<{key:string;body:string}|null>(null);
  const organogram=useQuery({
    queryKey:["staff-organogram",site.id,page],
    queryFn:()=>request(`${sitePath(site.id)}/staff/organogram?page=${page}&pageSize=50`,organogramSchema),
    retry:false,
  });
  const assignment=useMutation({
    mutationFn:(body:{staffUserId:string;roleCode:string;reportsToPlacementId:string|null;expectedVersion:number;reason:string})=>{
      const serialized=JSON.stringify(body);
      if(!assignmentAttempt.current||assignmentAttempt.current.body!==serialized)
        assignmentAttempt.current={key:crypto.randomUUID(),body:serialized};
      return request(`${sitePath(site.id)}/staff/role-placements`,resultSchema,{method:"POST",commandId:assignmentAttempt.current.key,body});
    },
    onSuccess:async result=>{
      assignmentAttempt.current=null;setReason("");setError(null);
      toast(`${result.role.label} role saved for ${result.displayName}.`);
      await client.invalidateQueries({queryKey:["staff-organogram",site.id]});
    },
    onError:async err=>{
      setError(err);
      if(err instanceof ApiError&&err.status===409){assignmentAttempt.current=null;await client.invalidateQueries({queryKey:["staff-organogram",site.id]});}
    },
  });
  const ending=useMutation({
    mutationFn:({placementId,expectedVersion,reason:why}:{placementId:string;expectedVersion:number;reason:string})=>{
      const body={expectedVersion,reason:why};
      const serialized=JSON.stringify({placementId,...body});
      if(!endAttempt.current||endAttempt.current.body!==serialized)
        endAttempt.current={key:crypto.randomUUID(),body:serialized};
      return request(`${sitePath(site.id)}/staff/role-placements/${encodeURIComponent(placementId)}/end`,resultSchema,{method:"POST",commandId:endAttempt.current.key,body});
    },
    onSuccess:async result=>{
      endAttempt.current=null;setEndTarget(null);setError(null);
      toast(`${result.role.label} role ended for ${result.displayName}.`);
      await client.invalidateQueries({queryKey:["staff-organogram",site.id]});
    },
    onError:async err=>{
      setError(err);
      if(err instanceof ApiError&&err.status===409){endAttempt.current=null;await client.invalidateQueries({queryKey:["staff-organogram",site.id]});}
    },
  });

  const data=organogram.data;
  const canManageRoles=site.canWrite;
  const assignableRoles=data?.roles.filter(role=>role.assignableByHead)??[];
  const currentStaff=data?.staff.find(person=>person.id===staffUserId);
  const availableManagers=data?.placements.filter(item=>item.state==="active"&&item.staffUserId!==staffUserId)??[];
  const maxPages=Math.max(data?.totalPages??0,data?.staffTotalPages??0,1);

  function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    setError(null);
    if(!staffUserId||!roleCode||!reason.trim()){
      setError(new Error("Choose a staff member and role, then add a short reason."));
      return;
    }
    const existing=currentStaff?.rolePlacements.find(item=>item.roleCode===roleCode&&item.state==="active");
    assignment.mutate({staffUserId,roleCode,reportsToPlacementId:reportsToPlacementId||null,expectedVersion:existing?.revision??0,reason:reason.trim()});
  }

  function endPlacement(item:Placement){
    if(!window.confirm(`End ${item.role.label} for ${item.displayName}? The role history will remain in the record.`))return;
    setError(null);setEndTarget(item);
    ending.mutate({placementId:item.id,expectedVersion:item.revision,reason:`Role ended by Head of Service Centre for ${item.displayName}.`});
  }

  if(organogram.isPending)return <Loading label="Loading staff and roles"/>;
  if(organogram.isError){
    if(organogram.error instanceof ApiError&&organogram.error.status===403){
      return <section className="panel max-w-2xl border-l-2 border-l-zinc-500 p-6" aria-labelledby="workforce-restricted">
        <p className="text-xs font-semibold uppercase text-zinc-500">Staff access</p>
        <h1 id="workforce-restricted" className="mt-2 text-xl font-semibold text-zinc-950">This section is for the Head of Service Centre</h1>
        <p className="mt-2 text-sm leading-6 text-zinc-600">Ask your Head if you need a role update. Your current access has not changed.</p>
      </section>;
    }
    return <Failure error={organogram.error} retry={()=>void organogram.refetch()}/>;
  }
  if(!data)return <Loading label="Loading staff and roles"/>;

  return <>
    <PageHeading eyebrow="People and work roles" title="Staff and roles">
      View who works at this service centre, set existing roles, and keep reporting lines up to date.
    </PageHeading>
    {!online&&<div role="status" className="mb-5 border-l-2 border-l-amber-600 bg-amber-50 px-4 py-3 text-sm text-amber-900">Connect to assign or change staff roles.</div>}
    <div className="mb-6 grid gap-4 sm:grid-cols-2">
      <div className="panel border-l-2 border-l-zinc-400 px-5 py-4">
        <p className="text-sm text-zinc-500">Active staff role assignments</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums text-zinc-950">{data.totalCount}</p>
      </div>
      <div className="panel border-l-2 border-l-zinc-400 px-5 py-4">
        <p className="text-sm text-zinc-500">Staff with site access</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums text-zinc-950">{data.staffTotalCount}</p>
      </div>
    </div>

    <section className="panel mb-7" aria-labelledby="role-descriptions-title">
      <div className="panel-heading">
        <div>
          <h2 id="role-descriptions-title" className="section-title">Role descriptions</h2>
          <p className="mt-1 text-sm text-zinc-500">Review what each role is responsible for at this service centre.</p>
        </div>
      </div>
      <ul className="grid gap-3 p-5 sm:grid-cols-2 sm:p-6">
        {data.roles.map(role=><li key={role.code} className="min-w-0 border-l-2 border-l-zinc-300 pl-4 py-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="text-sm font-semibold text-zinc-900">{role.label}</h3>
            {role.code==="vmms-operator"&&<span className="text-xs text-zinc-500">Account management is separate</span>}
          </div>
          <p className="mt-1 text-sm leading-5 text-zinc-600">{role.description}</p>
        </li>)}
      </ul>
    </section>

    {!canManageRoles&&<p className="mb-5 border-l-2 border-l-amber-600 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="status">Your site access is read-only. You can review staff roles, but you cannot change them with this account.</p>}
    {canManageRoles&&<section className="panel mb-7" aria-labelledby="assign-role-title">
      <div className="panel-heading">
        <div>
          <h2 id="assign-role-title" className="section-title flex items-center gap-2"><UserRoundPlus className="size-4" aria-hidden="true"/>Assign a role</h2>
          <p className="mt-1 text-sm text-zinc-500">Choose an existing role for a staff account. A role does not give anyone sign-off authority.</p>
        </div>
      </div>
      <form onSubmit={submit} className="grid gap-4 p-5 sm:grid-cols-2 sm:p-6">
        <label className="flex flex-col gap-1 text-sm font-medium text-zinc-700" htmlFor="workforce-person">
          Staff member
          <select id="workforce-person" value={staffUserId} onChange={event=>setStaffUserId(event.target.value)} required>
            <option value="">Choose a staff member</option>
            {data.staff.map(person=><option key={person.id} value={person.id}>{person.displayName}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-zinc-700" htmlFor="workforce-role">
          Role
          <select id="workforce-role" value={roleCode} onChange={event=>setRoleCode(event.target.value)} required>
            <option value="">Choose a role</option>
            {assignableRoles.map(role=><option key={role.code} value={role.code}>{role.label}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-zinc-700 sm:col-span-2" htmlFor="workforce-manager">
          Reports to
          <select id="workforce-manager" value={reportsToPlacementId} onChange={event=>setReportsToPlacementId(event.target.value)}>
            <option value="">No reporting manager</option>
            {availableManagers.map(item=><option key={item.id} value={item.id}>{item.displayName} — {item.role.label}</option>)}
          </select>
        </label>
        {currentStaff&&<p className="sm:col-span-2 -mt-2 text-xs text-zinc-500">Current roles: {currentStaff.roleCodes.length?currentStaff.roleCodes.map(code=>data.roles.find(role=>role.code===code)?.label??code).join(", "):"None"}</p>}
        <label className="flex flex-col gap-1 text-sm font-medium text-zinc-700 sm:col-span-2" htmlFor="workforce-reason">
          Reason
          <input id="workforce-reason" value={reason} onChange={event=>setReason(event.target.value)} maxLength={500} required placeholder="For example, assigned to the EV team"/>
        </label>
        {error!==null&&<div className="sm:col-span-2"><FormError error={error}/></div>}
        <div className="sm:col-span-2">
          <Button type="submit" disabled={!online||assignment.isPending||ending.isPending}>
            <BriefcaseBusiness className="size-4" aria-hidden="true"/>{assignment.isPending?"Saving role…":"Save role"}
          </Button>
        </div>
      </form>
    </section>}

    <section className="panel" aria-labelledby="staff-list-title">
      <div className="panel-heading flex-wrap">
        <div><h2 id="staff-list-title" className="section-title">Staff roles</h2><p className="mt-1 text-sm text-zinc-500">Role changes stay in the history. A reporting line does not assign jobs.</p></div>
        <p className="text-xs text-zinc-500">Page {page} of {maxPages}</p>
      </div>
      {data.placements.length===0?<Empty title="No staff role assignments on this page">Use the page controls to check other staff, or assign an existing role above.</Empty>:<>
        <ul className="divide-y divide-zinc-100">
          {data.placements.map(item=><li key={item.id} className="flex flex-col gap-3 border-l-2 border-l-zinc-300 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <div className="min-w-0">
              <p className="truncate font-medium text-zinc-950">{item.displayName}</p>
              <p className="mt-1 text-sm text-zinc-700">{item.role.label}</p>
              <p className="mt-1 text-xs text-zinc-500">{item.reportsToName?`Reports to ${item.reportsToName}`:"No reporting manager set"}</p>
            </div>
            {item.state==="active"&&canManageRoles?<Button type="button" variant="secondary" className="w-full sm:w-auto" disabled={!online||ending.isPending||assignment.isPending} onClick={()=>endPlacement(item)}>End role</Button>:item.state==="active"?<span className="text-xs text-zinc-500">Active</span>:<span className="text-xs text-zinc-500">Ended</span>}
          </li>)}
        </ul>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 px-5 py-4 sm:px-6">
          <p className="text-xs text-zinc-500">Showing {data.placements.length} role assignments for {data.staff.length} staff accounts on this page.</p>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" disabled={page<=1} onClick={()=>setPage(value=>Math.max(1,value-1))}><ArrowLeft className="size-4" aria-hidden="true"/>Previous</Button>
            <Button type="button" variant="secondary" disabled={page>=maxPages} onClick={()=>setPage(value=>Math.min(maxPages,value+1))}>Next<ArrowRight className="size-4" aria-hidden="true"/></Button>
          </div>
        </div>
      </>}
    </section>
    {endTarget&&ending.isPending&&<p className="sr-only" role="status">Ending role for {endTarget.displayName}</p>}
  </>;
}
