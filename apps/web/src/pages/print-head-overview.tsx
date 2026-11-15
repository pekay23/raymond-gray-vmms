import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { ApiError, request, workforceOverviewPath, workforceOverviewSchema } from "../api";
import { dateTime, Failure, Loading, useOnline } from "../ui";
import { useStaff } from "../workspace";

export function PrintHeadOverview() {
  const { site } = useStaff();
  const online = useOnline();
  const query = useQuery({
    queryKey: ["workforce-overview-report", site.id],
    queryFn: () => request(workforceOverviewPath(site.id), workforceOverviewSchema),
    enabled: online,
    retry: false,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (!query.data) return;
    const previousTitle = document.title;
    document.title = `${site.name} service-centre report`;
    return () => { document.title = previousTitle; };
  }, [query.data, site.name]);

  if (!online) return <section className="panel m-6 border-l-2 border-l-amber-600 p-6" role="status"><h1 className="text-xl font-semibold">Reconnect to prepare this report</h1><p className="mt-2 text-sm text-zinc-600">The report needs a fresh service-centre snapshot. No cached figures are shown.</p></section>;
  if (query.isPending) return <Loading label="Preparing service-centre report" />;
  if (query.isError || !query.data) {
    if (query.error instanceof ApiError && query.error.status === 403) {
      return <section className="panel m-6 max-w-2xl border-l-2 border-l-zinc-500 p-6"><h1 className="text-xl font-semibold">This report is for the Head of Service Centre</h1><p className="mt-2 text-sm text-zinc-600">Your access has not changed. Return to work orders or ask your Head for an update.</p><Link className="button button-secondary mt-4 inline-flex" to={`/sites/${site.id}/work-orders`}>Go to work orders</Link></section>;
    }
    return <Failure error={query.error ?? new Error("The service-centre report could not be prepared.")} retry={() => void query.refetch()} />;
  }

  const { data } = query;
  return (
    <main className="overview-report-page">
      <div className="overview-report-toolbar mb-5 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link className="button button-secondary" to={`/sites/${site.id}/overview`}><ArrowLeft className="size-4" aria-hidden="true" />Back to overview</Link>
        <button className="button button-primary" type="button" onClick={() => window.print()}>Print report</button>
      </div>
      <article className="overview-report mx-auto max-w-4xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-10" aria-labelledby="overview-report-title">
        <header className="border-b-2 border-zinc-900 pb-6">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-zinc-600">Raymond Gray · {site.name}</p>
          <h1 id="overview-report-title" className="mt-3 text-3xl font-semibold text-zinc-950">Service-centre operations</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-600">A point-in-time summary of current workload, review queues and staffing.</p>
          <dl className="mt-6 grid gap-4 border-t border-zinc-200 pt-4 sm:grid-cols-2">
            <ReportMeta label="Figures current as of" value={dateTime(data.asOf, site.timeZone)} />
            <ReportMeta label="Report prepared" value={dateTime(new Date().toISOString(), site.timeZone)} />
          </dl>
        </header>

        <section className="overview-report-section mt-7" aria-labelledby="report-work-title">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-blue-800">01 · Workshop</p>
          <h2 id="report-work-title" className="mt-2 border-b border-zinc-300 pb-3 text-xl font-semibold text-zinc-950">Current workload</h2>
          <dl className="mt-4 grid gap-3 sm:grid-cols-2">
            <ReportMetric label="Active jobs" value={data.workOrders.active} />
            <ReportMetric label="Jobs on hold" value={data.workOrders.held} tone="amber" />
          </dl>
        </section>

        <section className="overview-report-section mt-7" aria-labelledby="report-review-title">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-800">02 · Decisions</p>
          <h2 id="report-review-title" className="mt-2 border-b border-zinc-300 pb-3 text-xl font-semibold text-zinc-950">Work awaiting a next step</h2>
          <dl className="mt-4 grid gap-3 sm:grid-cols-3">
            <ReportMetric label="Operations review" value={data.workOrders.awaitingOperationsReview} />
            <ReportMetric label="Team-lead assignment" value={data.workOrders.awaitingTeamLead} />
            <ReportMetric label="Assigned to a team lead" value={data.workOrders.assignedToTeamLead} />
          </dl>
        </section>

        <section className="overview-report-section mt-7" aria-labelledby="report-staff-title">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-violet-800">03 · People</p>
          <h2 id="report-staff-title" className="mt-2 border-b border-zinc-300 pb-3 text-xl font-semibold text-zinc-950">Staff access</h2>
          <dl className="mt-4 grid gap-3 sm:grid-cols-2">
            <ReportMetric label="Active staff accounts" value={data.staff.active} />
            <ReportMetric label="Active staff role assignments" value={data.staff.activeRolePlacements} />
          </dl>
        </section>

        <footer className="mt-8 border-t border-zinc-300 pt-4 text-xs leading-5 text-zinc-600">
          This report contains current aggregate counts only. It is not a work authorization, vehicle release, invoice or financial statement. Open the relevant record in VMMS for its current status and history.
        </footer>
      </article>
    </main>
  );
}

function ReportMeta({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs font-semibold uppercase tracking-wide text-zinc-600">{label}</dt><dd className="mt-1 text-sm font-medium text-zinc-900">{value}</dd></div>;
}

function ReportMetric({ label, value, tone = "blue" }: { label: string; value: number; tone?: "blue" | "amber" }) {
  return <div className={`keep-together min-w-0 border-l-4 ${tone === "amber" ? "border-amber-600" : "border-blue-700"} bg-zinc-50 px-4 py-3`}><dt className="text-sm text-zinc-600">{label}</dt><dd className="mt-1 text-2xl font-semibold tabular-nums text-zinc-950">{value.toLocaleString("en-GH")}</dd></div>;
}
