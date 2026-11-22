import { useInfiniteQuery } from "@tanstack/react-query";
import { Activity, ArrowDown, RefreshCw } from "lucide-react";
import { ApiError, request, workforceActivityPath, workforceActivitySchema } from "../api";
import { useStaff } from "../workspace";
import { Button, Failure, Loading, PageHeading, dateTime, useOnline } from "../ui";

function eventLabel(value:string) {
  return value.replace(/^work-order\./, "").replaceAll("-", " ").replaceAll(".", " · ");
}

export function HeadActivity() {
  const {site}=useStaff();
  const online=useOnline();
  const activity=useInfiniteQuery({queryKey:["head-site-activity",site.id],initialPageParam:undefined as string|undefined,queryFn:({pageParam})=>request(workforceActivityPath(site.id,pageParam),workforceActivitySchema),getNextPageParam:lastPage=>lastPage.nextCursor??undefined,enabled:online,retry:false,refetchOnWindowFocus:true});

  if(!online) return <section className="panel max-w-3xl border-l-2 border-l-amber-600 p-6"><h1 className="text-xl font-semibold">Site activity needs a connection</h1><p className="mt-2 text-sm leading-6 text-zinc-600">Reconnect to load the latest recorded activity. This history is not available offline.</p></section>;
  if(activity.isPending) return <Loading label="Loading site activity" />;
  if(activity.isError) {
    if(activity.error instanceof ApiError&&activity.error.status===403) return <section className="panel max-w-2xl border-l-2 border-l-zinc-500 p-6"><h1 className="text-xl font-semibold">Site activity is for the Head of Service Centre</h1><p className="mt-2 text-sm text-zinc-600">Your access has not changed. Ask your Head if you need an activity update.</p></section>;
    return <Failure error={activity.error} retry={()=>void activity.refetch()} />;
  }
  const pages=activity.data?.pages??[];
  const items=pages.flatMap(page=>page.items);
  if(pages.length===0) return <Loading label="Loading site activity" />;
  return <>
    <PageHeading eyebrow={`Operations record · ${site.name}`} title="Site activity" action={<Button variant="secondary" onClick={()=>void activity.refetch()}><RefreshCw className="size-4" aria-hidden="true"/><span>Refresh</span></Button>}>
      A read-only history of recorded work-order changes at this service centre.
    </PageHeading>
    <section className="panel" aria-labelledby="site-activity-title">
      <div className="panel-heading"><div className="flex items-center gap-3"><Activity className="size-4 text-zinc-500" aria-hidden="true"/><h2 id="site-activity-title" className="section-title">Recent activity</h2></div><p className="text-xs text-zinc-600">Newest first · {pages[0]?.pageSize??25} per page</p></div>
      {items.length===0?<p className="px-6 py-8 text-sm text-zinc-600" role="status">No activity has been recorded for this service centre yet.</p>:<ol className="divide-y divide-zinc-100" aria-live="polite">
        {items.map(item=><li key={item.id} className="grid gap-2 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-6">
          <div className="min-w-0"><p className="break-words text-sm font-semibold capitalize text-zinc-900">{eventLabel(item.eventType)}</p><p className="mt-1 text-sm text-zinc-600">{item.actorName}{item.workOrderReference&&<> · <span className="font-mono">{item.workOrderReference}</span></>}</p><p className="mt-1 text-xs text-zinc-600">{item.aggregateType.replaceAll("-"," ")} · record version {item.aggregateVersion}</p></div>
          <time className="text-xs tabular-nums text-zinc-600" dateTime={item.createdAt}>{dateTime(item.createdAt,site.timeZone)}</time>
        </li>)}
      </ol>}
      {activity.hasNextPage&&<div className="border-t border-zinc-100 p-4"><Button variant="secondary" onClick={()=>void activity.fetchNextPage()} disabled={activity.isFetchingNextPage}><ArrowDown className="size-4" aria-hidden="true"/><span>{activity.isFetchingNextPage?"Loading older activity":"Load older activity"}</span></Button></div>}
    </section>
  </>;
}
