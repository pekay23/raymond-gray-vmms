import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { ApiError, request, workOrderChecklistReportPath, workOrderChecklistReportSchema } from "../api";
import { useStaff } from "../workspace";
import { Button, dateTime, Failure, Loading } from "../ui";

const PAGE_SIZE = 50;
const MAX_REPORT_PAGES = 100;
type ChecklistReport = ReturnType<typeof workOrderChecklistReportSchema.parse>;

async function readReport(siteId: string, orderId: string, checklistId: string): Promise<ChecklistReport> {
  const first = await request(workOrderChecklistReportPath(siteId, orderId, checklistId, 1, PAGE_SIZE), workOrderChecklistReportSchema);
  if (first.pagination.totalPages > MAX_REPORT_PAGES) {
    throw new ApiError("This checklist is too large for one printable report. Ask an administrator for a filtered report.", 413, "report_too_large");
  }
  const items = [...first.items];
  for (let page = 2; page <= first.pagination.totalPages; page += 1) {
    const next = await request(workOrderChecklistReportPath(siteId, orderId, checklistId, page, PAGE_SIZE, first.checklist.version), workOrderChecklistReportSchema);
    if (next.checklist.version !== first.checklist.version || next.pagination.totalItems !== first.pagination.totalItems) {
      throw new ApiError("Checklist results changed while this report was being prepared. Reload and try again.", 409, "report_checklist_changed");
    }
    items.push(...next.items);
  }
  return { ...first, items, preparedAt: new Date().toISOString() };
}

export function PrintMaintenanceChecklistReport() {
  const { site } = useStaff();
  const { orderId, checklistId } = useParams();
  const query = useQuery({
    queryKey: ["maintenance-checklist-report", site.id, orderId, checklistId],
    queryFn: () => readReport(site.id, orderId ?? "", checklistId ?? ""),
    enabled: Boolean(orderId && checklistId),
    retry: false,
  });

  useEffect(() => {
    if (!query.data) return;
    const previousTitle = document.title;
    document.title = `${query.data.bookingReference} maintenance checklist`;
    return () => { document.title = previousTitle; };
  }, [query.data]);

  if (query.isPending) return <Loading label="Preparing maintenance report" />;
  if (query.isError || !query.data) return <Failure error={query.error ?? new Error("This maintenance report could not be prepared.")} retry={() => void query.refetch()} />;
  const report = query.data;
  const complete = report.summary.totalItems === report.summary.completed + report.summary.notApplicable;
  return (
    <main className="task-progress-report-page min-h-screen bg-zinc-100 px-4 py-6 sm:px-8">
      <div className="task-progress-report-toolbar mx-auto mb-5 flex max-w-4xl flex-wrap items-center justify-between gap-3">
        <Link className="button button-secondary" to={`/sites/${encodeURIComponent(site.id)}/work-orders/${encodeURIComponent(report.workOrderId)}`}>Back to job</Link>
        <Button type="button" onClick={() => window.print()}>Print maintenance report</Button>
      </div>
      <article className="task-progress-report mx-auto max-w-4xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-10" aria-labelledby="maintenance-report-title">
        <header className="border-b-2 border-zinc-900 pb-6">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-zinc-600">Raymond Gray · {report.siteName}</p>
              <h1 id="maintenance-report-title" className="mt-3 text-2xl font-semibold text-zinc-950 sm:text-3xl">Routine maintenance report</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-600">Recorded checklist results for this workshop visit. Open items and reasons are shown so the team can agree the next step.</p>
            </div>
            <div className="min-w-52 border-l-4 border-amber-500 pl-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Booking reference</p>
              <p className="mt-1 font-mono text-xl font-semibold tabular-nums text-zinc-950">{report.bookingReference}</p>
              <p className="mt-2 text-sm font-medium capitalize text-zinc-700">Checklist {report.checklist.state.replaceAll("-", " ")} · version {report.checklist.version}</p>
            </div>
          </div>
          <dl className="mt-6 grid grid-cols-2 gap-4 border-t border-zinc-200 pt-4 text-sm sm:grid-cols-4">
            <Meta label="Vehicle" value={`${report.vehicle.make} ${report.vehicle.model}${report.vehicle.variant ? ` · ${report.vehicle.variant}` : ""}`} />
            <Meta label="Registration" value={report.vehicle.registration || "Not recorded"} />
            <Meta label="Checklist" value={`${report.checklist.templateCode} · revision ${report.checklist.templateRevision}`} />
            <Meta label="Mileage at visit" value={report.checklist.odometerAtStartKm === null ? "Not recorded" : `${report.checklist.odometerAtStartKm.toLocaleString("en-GH")} km`} />
          </dl>
        </header>

        <section className="task-progress-report-section mt-7" aria-labelledby="maintenance-summary-title">
          <SectionTitle id="maintenance-summary-title" number="01" title="Work summary" />
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Count label="Checklist items" value={report.summary.totalItems} />
            <Count label="Completed" value={report.summary.completed} />
            <Count label="Failed" value={report.summary.failed} />
            <Count label="Still open" value={report.summary.notChecked + report.summary.notCompleted + report.summary.blocked} />
          </dl>
          <p className={`mt-4 border-l-4 px-3 py-2 text-sm leading-6 ${complete ? "border-emerald-600 bg-emerald-50 text-emerald-950" : "border-amber-500 bg-amber-50 text-amber-950"}`}>
            {complete ? "Every checklist item has a recorded completed or not-applicable result." : "This checklist still has open or failed items. Review the reasons and next steps below."}
          </p>
        </section>

        <section className="task-progress-report-section mt-7" aria-labelledby="maintenance-source-title">
          <SectionTitle id="maintenance-source-title" number="02" title="Schedule and source" />
          <p className="text-sm leading-6 text-zinc-700">Schedule basis: {report.checklist.scheduleBasis === "unknown" ? "Not confirmed" : report.checklist.scheduleBasis.replaceAll("-", " ")}</p>
          {report.checklist.sources.length === 0 ? <p className="mt-2 text-sm text-red-800">No source revision is linked to this checklist.</p> : <ul className="mt-2 space-y-2">{report.checklist.sources.map((source) => <li key={`${source.reference}:${source.revision}`} className="keep-together border-l-2 border-zinc-300 pl-3 text-sm">
            <p className="font-medium text-zinc-900">{source.reference} · {source.title} · revision {source.revision}</p>
            <p className="mt-1 text-xs text-zinc-600">{source.current ? "Current effective source" : `Source status: ${source.status}; verify before relying on it`}</p>
          </li>)}</ul>}
        </section>

        <section className="task-progress-report-section mt-7" aria-labelledby="maintenance-items-title">
          <SectionTitle id="maintenance-items-title" number="03" title="Checklist results" />
          {report.items.length === 0 ? <p className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-600">No checklist items were found in this revision.</p> : <ol className="space-y-4">{report.items.map((item) => <li key={item.id} className="keep-together border-l-4 border-amber-500 pl-4">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h3 className="text-sm font-semibold text-zinc-950"><span className="font-mono text-zinc-500">{item.ordinal.toString().padStart(2, "0")}</span> · {item.label}</h3>
              <span className="rounded-full border border-zinc-300 px-2 py-1 text-xs font-medium capitalize text-zinc-800">{item.result ? item.result.replaceAll("-", " ") : "Not recorded"}</span>
            </div>
            {item.reason && <p className="mt-2 text-sm leading-6 text-zinc-700"><strong>Reason:</strong> {item.reason}</p>}
            {item.applicabilityReason && <p className="mt-2 text-sm leading-6 text-zinc-700"><strong>Applicability:</strong> {item.applicabilityReason}</p>}
            {item.comments && <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-zinc-700"><strong>Notes:</strong> {item.comments}</p>}
            {item.measurement && <p className="mt-2 text-sm leading-6 text-zinc-700"><strong>Measurement:</strong> {Object.entries(item.measurement).map(([key, value]) => `${key}: ${String(value)}`).join(" · ")}</p>}
            {item.evidenceLabels.length > 0 && <p className="mt-2 text-sm text-zinc-700"><strong>Evidence:</strong> {item.evidenceLabels.join(", ")}</p>}
            {item.revision && <p className="mt-2 text-xs text-zinc-500">Recorded by {item.actorName ?? "Unknown staff member"}{item.assigneeName ? ` for ${item.assigneeName}` : ""}{item.taskReference ? ` · task ${item.taskReference}${item.taskTitle ? ` ${item.taskTitle}` : ""}` : ""}{item.recordedAt ? ` · ${dateTime(item.recordedAt, site.timeZone)}` : ""}{item.revision > 1 ? ` · correction revision ${item.revision}${item.correctionReason ? `: ${item.correctionReason}` : ""}` : ""}</p>}
          </li>)}</ol>}
        </section>

        <footer className="mt-8 border-t-2 border-zinc-900 pt-4 text-xs leading-5 text-zinc-700">
          <p className="font-semibold">Internal workshop report · Prepared {dateTime(report.preparedAt, site.timeZone)}</p>
          <p className="mt-1">This report shows saved checklist records only. It is not a repair authorization, technical completion sign-off, independent inspection, release to service, payment record or permission to collect the vehicle.</p>
          <p className="mt-1">If the linked procedure is no longer current, stop and ask the responsible technical lead to confirm the applicable source before work continues.</p>
        </footer>
      </article>
    </main>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{label}</dt><dd className="mt-1 break-words text-sm font-medium text-zinc-900">{value}</dd></div>;
}

function Count({ label, value }: { label: string; value: number }) {
  return <div className="rounded-md border border-zinc-200 border-l-4 border-l-amber-500 px-3 py-2"><dt className="text-xs font-semibold text-zinc-600">{label}</dt><dd className="mt-1 text-2xl font-semibold tabular-nums text-zinc-950">{value}</dd></div>;
}

function SectionTitle({ id, number, title }: { id: string; number: string; title: string }) {
  return <h2 id={id} className="mb-4 flex items-baseline gap-3 border-b border-zinc-200 pb-2 text-lg font-semibold text-zinc-950"><span className="font-mono text-xs text-zinc-500">{number}</span>{title}</h2>;
}
