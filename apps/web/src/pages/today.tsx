import { ArrowRight, BookOpen, CarFront, ClipboardList, ClipboardCheck, FilePlus2, Gauge, MessageSquareText } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { Link } from "react-router-dom";
import { request, sitePath } from "../api";
import { Failure, Loading, PageHeading, dateTime } from "../ui";
import { useStaff } from "../workspace";
import { workspaceCapabilities } from "../workspace-navigation";

const callbackListSchema = z.object({
  items: z.array(z.object({
    id: z.string().uuid(),
    concern: z.string(),
    reportedVehicle: z.string().nullable(),
    nextAction: z.string().nullable(),
    callbackDueAt: z.string().nullable(),
  })),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  totalCount: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
});

type Action = {
  title: string;
  description: string;
  href: string;
  action: string;
  icon: typeof ClipboardList;
};

export function Today() {
  const { site } = useStaff();
  const capabilities = workspaceCapabilities(site);
  const base = `/sites/${site.id}`;
  const actions: Action[] = [];

  if (capabilities.canOpenRequests) {
    actions.push({
      title: "Requests and callbacks",
      description: "Record a concern or follow up on a request you can access.",
      href: `${base}/requests`,
      action: "Open requests",
      icon: MessageSquareText,
    });
  }
  if (capabilities.canOpenWorkOrders) {
    actions.push({
      title: "Work orders",
      description: "Continue with the jobs and updates available to your role.",
      href: `${base}/work-orders`,
      action: "Open work orders",
      icon: ClipboardList,
    });
  }
  if (capabilities.canOpenMyTasks) {
    actions.push({
      title: "My assigned tasks",
      description: "Review your current assignments and record progress or requests.",
      href: `${base}/my-tasks`,
      action: "Open my tasks",
      icon: ClipboardCheck,
    });
  }
  if (capabilities.canOpenVehicleHistory) {
    actions.push({
      title: "Vehicles and history",
      description: "Review recorded deliveries, PDI observations and available vehicle history.",
      href: `${base}/sales-deliveries`,
      action: "Open vehicles",
      icon: CarFront,
    });
  }
  if (capabilities.canOpenHeadOverview) {
    actions.push({
      title: "Service-centre overview",
      description: "Review the current service-centre overview and reports.",
      href: `${base}/overview`,
      action: "Open overview",
      icon: Gauge,
    });
  }
  if (capabilities.canRegisterVisit && site.canWrite) {
    actions.push({
      title: "Register a vehicle visit",
      description: "Record a vehicle that has arrived at the service centre.",
      href: `${base}/intake`,
      action: "Start intake",
      icon: FilePlus2,
    });
  }
  if (capabilities.canOpenDocuments) {
    actions.push({
      title: "Documents",
      description: "Read current service-centre documents available to your role.",
      href: `${base}/documents`,
      action: "Open documents",
      icon: BookOpen,
    });
  }

  return (
    <>
      <PageHeading eyebrow={site.name} title="Today">
        Start with what needs your attention.
      </PageHeading>
      {capabilities.canOpenRequests && <CallbacksDue />}
      <section aria-labelledby="today-work-areas" className="space-y-4">
        <h2 id="today-work-areas" className="text-base font-semibold text-zinc-950">Your work areas</h2>
        <ul className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {actions.map(({ title, description, href, action, icon: Icon }) => (
            <li key={href} className="min-w-0">
              <article className="panel flex h-full min-w-0 flex-col p-5">
                <div className="flex items-start gap-3">
                  <Icon className="mt-0.5 size-5 shrink-0 text-zinc-600" aria-hidden="true" />
                  <div className="min-w-0">
                    <h3 className="text-base font-semibold text-zinc-950">{title}</h3>
                    <p className="mt-2 text-pretty text-sm leading-6 text-zinc-600">{description}</p>
                  </div>
                </div>
                <Link className="mt-5 inline-flex min-h-11 items-center gap-2 self-start rounded-md font-semibold text-blue-800 underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-800" to={href}>
                  {action}<ArrowRight className="size-4" aria-hidden="true" />
                </Link>
              </article>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

function CallbacksDue() {
  const { site } = useStaff();
  const base = `${sitePath(site.id)}/service-requests`;
  const overdue = useQuery({
    queryKey: ["today-callbacks", site.id, "overdue"],
    queryFn: () => request(`${base}?filter=overdue&page=1&pageSize=4`, callbackListSchema),
  });
  const dueToday = useQuery({
    queryKey: ["today-callbacks", site.id, "due-today"],
    queryFn: () => request(`${base}?filter=due-today&page=1&pageSize=4`, callbackListSchema),
  });

  return (
    <section aria-labelledby="today-callbacks-title" className="panel mb-7 min-w-0 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="today-callbacks-title" className="text-lg font-semibold text-zinc-950">Callbacks due</h2>
        <Link className="font-semibold text-blue-800 underline underline-offset-4" to={`/sites/${site.id}/requests`}>
          Open requests
        </Link>
      </div>
      {overdue.isPending || dueToday.isPending ? (
        <Loading label="Loading callbacks" />
      ) : overdue.isError ? (
        <Failure error={overdue.error} retry={() => void overdue.refetch()} />
      ) : dueToday.isError ? (
        <Failure error={dueToday.error} retry={() => void dueToday.refetch()} />
      ) : overdue.data.totalCount === 0 && dueToday.data.totalCount === 0 ? (
        <p className="mt-3 text-sm text-zinc-600">No overdue callbacks or callbacks due today.</p>
      ) : (
        <div className="mt-4 grid min-w-0 gap-5 lg:grid-cols-2">
          <CallbackGroup label="Overdue" filter="overdue" siteId={site.id} timeZone={site.timeZone} list={overdue.data} />
          <CallbackGroup label="Due today" filter="due-today" siteId={site.id} timeZone={site.timeZone} list={dueToday.data} />
        </div>
      )}
    </section>
  );
}

function CallbackGroup({
  label,
  filter,
  siteId,
  timeZone,
  list,
}: {
  label: string;
  filter: "overdue" | "due-today";
  siteId: string;
  timeZone: string;
  list: z.infer<typeof callbackListSchema>;
}) {
  const visible = list.items.slice(0, 4);
  return (
    <div className="min-w-0">
      <h3 className="font-semibold text-zinc-900">{label} <span className="font-normal text-zinc-600">({list.totalCount})</span></h3>
      {visible.length === 0 ? (
        <p className="mt-2 text-sm text-zinc-600">None.</p>
      ) : (
        <ul className="mt-2 divide-y divide-zinc-200">
          {visible.map((item) => (
            <li key={item.id} className="min-w-0 py-3">
              <Link
                className="font-semibold text-blue-800 underline underline-offset-4"
                to={`/sites/${siteId}/requests?request=${encodeURIComponent(item.id)}&filter=${filter}`}
              >
                {item.nextAction || "Review the request"}
              </Link>
              <p className="mt-1 break-words text-sm text-zinc-800">{item.concern}</p>
              <p className="mt-1 break-words text-sm text-zinc-600">
                {item.reportedVehicle || "Vehicle not confirmed"}
                {item.callbackDueAt ? ` · ${dateTime(item.callbackDueAt, timeZone)}` : " · Callback time not recorded"}
              </p>
            </li>
          ))}
        </ul>
      )}
      {list.totalCount > visible.length && (
        <Link className="mt-2 inline-flex min-h-11 items-center gap-2 font-semibold text-blue-800 underline underline-offset-4" to={`/sites/${siteId}/requests?filter=${filter}`}>
          See all {label.toLowerCase()} callbacks <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      )}
    </div>
  );
}
