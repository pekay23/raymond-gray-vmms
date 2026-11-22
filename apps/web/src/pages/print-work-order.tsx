import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { useEffect } from "react";
import type { DiagnosticObservation, ServiceReport, SourceReportRevision, WorkOrder } from "../api";
import { request, serviceReportPageSchema, serviceReportPath, serviceReportSchema, sourceReportHistorySchema, sourceReportsPath } from "../api";
import { useStaff } from "../workspace";
import { Button, Failure, Loading, dateTime } from "../ui";

const serviceKindLabels: Record<WorkOrder["serviceKind"], string> = {
  "repair-maintenance": "Repair or maintenance",
  "routine-maintenance": "Routine maintenance",
  psai: "Post-shipping acceptance inspection",
  "service-centre-pdi": "Service Centre pre-delivery inspection",
};
const serviceSourceLabels: Record<WorkOrder["serviceSource"], string> = {
  "showroom-stock": "Showroom stock",
  "partner-garage": "Partner garage",
  other: "Other source",
  unknown: "Not known yet",
};

export function PrintWorkOrder() {
  const { site } = useStaff();
  const { orderId } = useParams();
  const query = useQuery({
    queryKey: ["work-order-service-report", site.id, orderId],
    queryFn: async () => {
      const [first, sourceHistory] = await Promise.all([
        request(serviceReportPath(site.id, orderId ?? "", 1), serviceReportPageSchema),
        request(sourceReportsPath(site.id, orderId ?? ""), sourceReportHistorySchema),
      ]);
      if (!first.generatedAt || !first.order || first.pagination.page !== 1) {
        throw new Error("The first report page did not include its report details. Reload and try again.");
      }
      if (sourceHistory.workOrderVersion !== first.workOrderVersion) throw new Error("The work order changed while the report was being prepared. Reload and try again.");
      if (first.pagination.pageSize !== 50
        || first.pagination.totalPages !== Math.ceil(first.pagination.totalItems / first.pagination.pageSize)
        || first.entries.length !== Math.min(first.pagination.pageSize, first.pagination.totalItems)) {
        throw new Error("The first report page is incomplete. Reload and try again.");
      }
      const entries = [...first.entries];
      for (let page = 2; page <= first.pagination.totalPages; page += 1) {
        const next = await request(
          serviceReportPath(site.id, orderId ?? "", page, first.workOrderVersion, first.pagination.totalItems),
          serviceReportPageSchema,
        );
        if (next.pagination.page !== page
          || next.pagination.pageSize !== first.pagination.pageSize
          || next.pagination.totalItems !== first.pagination.totalItems
          || next.pagination.totalPages !== first.pagination.totalPages
          || next.workOrderVersion !== first.workOrderVersion
          || next.generatedAt !== null
          || next.order !== null
          || next.entries.length !== Math.min(first.pagination.pageSize, first.pagination.totalItems - entries.length)) {
          throw new Error("The report changed while its pages were loading. Reload and try again.");
        }
        entries.push(...next.entries);
      }
      const entryIds = new Set(entries.map((entry) => entry.id));
      if (entries.length !== first.pagination.totalItems || entryIds.size !== entries.length) {
        throw new Error("Some work history is missing or repeated. Reload the report before printing.");
      }
      const inStableOrder = entries.every((entry, index) => {
        if (index === 0) return true;
        const previous = entries[index - 1];
        if (!previous) return false;
        return previous.recordedAt < entry.recordedAt
          || (previous.recordedAt === entry.recordedAt && previous.id < entry.id);
      });
      if (!inStableOrder) throw new Error("The work history pages arrived out of order. Reload the report before printing.");
      return { ...serviceReportSchema.parse({ ...first, entries }), sourceReports: sourceHistory.reports };
    },
    enabled: Boolean(orderId),
    retry: false,
  });

  useEffect(() => {
    if (!query.data) return;
    const previousTitle = document.title;
    document.title = `Workshop service report ${query.data.order.reference}`;
    return () => { document.title = previousTitle; };
  }, [query.data]);

  if (query.isPending) return <Loading label="Preparing the complete service report" />;
  if (query.isError || !query.data) {
    return <Failure error={query.error ?? new Error("This work order could not be found.")} retry={() => void query.refetch()} />;
  }

  return <WorkOrderSummary report={query.data} siteName={site.name} siteId={site.id} timeZone={site.timeZone} />;
}

function WorkOrderSummary({ report, siteName, siteId, timeZone }: { report: ServiceReport & { sourceReports: SourceReportRevision[] }; siteName: string; siteId: string; timeZone: string }) {
  const { order } = report;
  const hasFindings = order.diagnosticFindings.length > 0 || order.evidence.length > 0;

  return (
    <main className="work-order-print-page">
      <div className="work-order-print-toolbar mb-5 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link className="button button-secondary" to={`/sites/${encodeURIComponent(siteId)}/work-orders/${order.id}`}>
          Back to work order
        </Link>
        <Button type="button" onClick={() => window.print()}>
          Print service report
        </Button>
      </div>

      <article className="work-order-print mx-auto max-w-4xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-10" aria-labelledby="print-title">
        <header className="work-order-print-header border-b-2 border-zinc-900 pb-6">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-zinc-600">Raymond Gray · {siteName}</p>
              <h1 id="print-title" className="mt-3 text-2xl font-semibold text-zinc-950 sm:text-3xl">Workshop service report</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-600">A structured account of the visit, reported concerns, recorded findings, work history and outstanding items.</p>
            </div>
            <div className="min-w-52 border-l-4 border-emerald-700 pl-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Booking reference</p>
              <p className="mt-1 font-mono text-xl font-semibold tabular-nums text-zinc-950">{order.reference}</p>
              <p className="mt-2 text-sm font-medium text-zinc-700">Record version {report.workOrderVersion}</p>
            </div>
          </div>
          <dl className="mt-6 grid grid-cols-2 gap-4 border-t border-zinc-200 pt-4 text-sm sm:grid-cols-5">
            <Meta label="Opened" value={dateTime(order.createdAt, timeZone)} />
            <Meta label="Report prepared" value={dateTime(report.generatedAt, timeZone)} />
            <Meta label="Requested service" value={serviceKindLabels[order.serviceKind]} />
            {order.serviceKind === "service-centre-pdi" && <Meta label="Reported vehicle source" value={serviceSourceLabels[order.serviceSource]} />}
            {order.serviceKind === "psai" && <Meta label="Shipping reference" value={order.shippingReference || "Not recorded"} />}
            <Meta label="Powertrain" value={order.powertrainClass ?? "Not recorded"} />
            <Meta label="Warranty at booking" value={warrantyLabel(order.warrantyStatusAtBooking)} />
          </dl>
        </header>

        <section className="print-section" aria-labelledby="parties-title">
          <SectionTitle id="parties-title" number="01" title="People and client" />
          <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-3">
            <Meta label="Paying client" value={order.client?.name ?? "Not recorded"} />
            <Meta label="Reported vehicle owner" value={order.owner?.name ?? "Not recorded"} note={order.owner ? ownerStateLabel(order.owner.state) : undefined} />
            <Meta label="Visit contact" value={order.visitContact?.name ?? "Not recorded"} />
          </dl>
        </section>

        <section className="print-section" aria-labelledby="vehicle-title">
          <SectionTitle id="vehicle-title" number="02" title="Vehicle and arrival" />
          <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-3">
            <Meta label="Vehicle" value={`${order.vehicle.make} ${order.vehicle.model}${order.vehicle.variant ? ` · ${order.vehicle.variant}` : ""}`} />
            <Meta label="Registration" value={order.vehicle.registration || "Not recorded"} />
            <Meta label="Vehicle identification number" value={order.vehicle.vin} mono />
            <Meta label="Odometer" value={`${order.odometerKm.toLocaleString("en-GH")} km`} />
            <Meta label="Battery charge" value={order.socPercent === null ? "Not recorded" : `${order.socPercent}%`} />
          </dl>
        </section>

        <section className="print-section" aria-labelledby="concerns-title">
          <SectionTitle id="concerns-title" number="03" title="Customer concerns and planned tasks" />
          {order.complaints.length === 0 ? <p className="text-sm text-zinc-600">No concerns have been recorded.</p> : (
            <ol className="space-y-4">
              {order.complaints.map((complaint) => {
                const tasks = order.tasks.filter((task) => task.complaintId === complaint.id);
                return <li key={complaint.id} className="keep-together border-l-2 border-zinc-300 pl-4">
                  <h3 className="text-sm font-semibold text-zinc-950"><span className="font-mono text-zinc-500">{complaint.reference}</span> · Customer concern</h3>
                  <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-zinc-800">{complaint.wording}</p>
                  {tasks.length > 0 && <ul className="mt-3 space-y-2">
                    {tasks.map((task) => <li key={task.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm">
                      <span><span className="font-mono text-zinc-500">{task.reference}</span> · {task.title}</span>
                      <span className="text-xs font-medium text-zinc-600">Planned · no work sign-off</span>
                    </li>)}
                  </ul>}
                </li>;
              })}
            </ol>
          )}
        </section>

        <section className="print-section" aria-labelledby="intake-title">
          <SectionTitle id="intake-title" number="04" title="Arrival notes" />
          {order.intakeFacts.length === 0 ? <p className="text-sm text-zinc-600">No arrival notes have been recorded.</p> : <ul className="grid gap-3 sm:grid-cols-2">
            {order.intakeFacts.map((item) => <li key={item.id} className="keep-together border-b border-zinc-200 pb-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-600">{intakeFactTitle(item.fact)}</p>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-zinc-800">{intakeFactDescription(item.fact)}</p>
              {item.correctionReason && <p className="mt-1 text-xs text-zinc-600">Correction: {item.correctionReason}</p>}
            </li>)}
          </ul>}
        </section>

        {hasFindings && <section className="print-section" aria-labelledby="findings-title">
          <SectionTitle id="findings-title" number="05" title="Diagnostic findings and attached files" />
          {order.diagnosticFindings.length > 0 && <ul className="space-y-4">
            {order.diagnosticFindings.map((finding) => <li key={finding.id} className="keep-together border-b border-zinc-200 pb-3">
              <p className="text-sm font-semibold text-zinc-950">{finding.certainty.state === "inconclusive" ? "Inconclusive finding" : "Finding"} · {dateTime(finding.observedAt, timeZone)}</p>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-zinc-800">{finding.summary}</p>
              <ul className="mt-2 space-y-1 text-sm text-zinc-700">
                {finding.observations.map((observation, index) => <li key={`${finding.id}-observation-${index}`}>{describeObservation(observation)}</li>)}
              </ul>
              <p className="mt-2 text-sm"><span className="font-medium">Remaining risk:</span> {finding.residualRisk}</p>
              {finding.restrictions && <p className="mt-1 text-sm"><span className="font-medium">Restrictions:</span> {finding.restrictions}</p>}
              <p className="mt-2 text-xs text-zinc-600">Recorded by {finding.recordedBy}. A finding does not approve repair or confirm a fix.</p>
            </li>)}
          </ul>}
          {order.evidence.length > 0 && <ul className="mt-4 grid gap-2 sm:grid-cols-2">
            {order.evidence.map((file) => <li key={file.evidenceId} className="flex flex-wrap justify-between gap-x-4 text-sm">
              <span className="break-words">{file.displayName}</span><span className="text-xs font-medium text-zinc-600">{evidenceStateLabel(file.state)}</span>
            </li>)}
          </ul>}
        </section>}

        {report.sourceReports.length > 0 && <section className="print-section" aria-labelledby="source-reports-title">
          <h2 id="source-reports-title" className="mb-4 border-b border-zinc-200 pb-2 text-xs font-bold uppercase tracking-[0.14em] text-zinc-600">Earlier reports transcribed for this visit</h2>
          <div className="space-y-5">{report.sourceReports.map(source => {
            const correction = report.sourceReports.find(next => next.supersedesReportId === source.id);
            return <section key={source.id} className={`keep-together border-l-2 pl-4 ${correction ? "border-zinc-300" : "border-sky-700"}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1"><h3 className="text-sm font-semibold text-zinc-950">{source.title} · {sourceKindLabel(source.sourceKind)}{correction ? ` · Superseded version ${source.revision}` : ` · Current transcription version ${source.revision}`}</h3><span className="text-xs text-zinc-600">Report date {source.sourceDate}</span></div>
            <p className="mt-1 text-xs leading-5 text-zinc-600">Transcribed by {source.recordedBy} on {dateTime(source.recordedAt, timeZone)}{source.sourceFile ? ` · Source file: ${source.sourceFile.displayName}` : " · Original source file not linked · Source author not recorded"}</p>
            {correction?.correctionReason && <p className="mt-1 text-xs text-amber-800">Correction reason: {correction.correctionReason}</p>}
            <ul className="mt-3 space-y-3">{source.items.map(item => <li key={item.id} className="break-words border-t border-zinc-100 pt-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-600">{sourceItemKindLabel(item.kind)} · {sourceItemResultLabel(item.result)}{item.sourceOccurrenceDate ? ` · ${item.sourceOccurrenceDate}` : ""}</p>
              <p className="mt-1 text-sm font-medium text-zinc-900">{item.summary}</p>
              {item.detail && <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-zinc-800">{item.detail}</p>}
              {item.complaintReference && <p className="mt-1 text-xs text-zinc-600">Linked concern {item.complaintReference}</p>}
            </li>)}</ul>
          </section>;})}</div>
          <p className="mt-4 text-xs leading-5 text-zinc-600">These are transcriptions of earlier reports. They do not identify who performed the work or approve technical completion, inspection or vehicle release.</p>
        </section>}

        <section className="print-section" aria-labelledby="work-history-title">
          <SectionTitle id="work-history-title" number={hasFindings ? "06" : "05"} title="Recorded findings, tests and work" />
          {report.entries.length === 0 ? <p className="text-sm text-zinc-600">No task work entries have been recorded.</p> : (
            <ol className="space-y-4">
              {report.entries.map((entry) => <li key={entry.id} className="keep-together border-l-2 border-blue-800 pl-4">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <h3 className="text-sm font-semibold text-zinc-950">{workEntryKindLabel(entry.kind)} · {entry.taskReference} · {entry.taskTitle}</h3>
                  <span className="text-xs font-medium text-zinc-600">{workEntryResultLabel(entry.result)}</span>
                </div>
                <p className="mt-1 text-xs text-zinc-600">For concern {entry.complaintReference} · {entry.observedAt ? `Observed ${dateTime(entry.observedAt, timeZone)} · ` : ""}Recorded by {entry.actorName} at {dateTime(entry.recordedAt, timeZone)}</p>
                <p className="mt-2 text-sm font-medium leading-6 text-zinc-900">{entry.summary}</p>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-zinc-800">{entry.detail}</p>
                {entry.supersedesEntryId && <p className="mt-1 text-xs text-amber-800">Corrects an earlier entry{entry.correctionReason ? `: ${entry.correctionReason}` : "."}</p>}
                {entry.evidence.length > 0 && <p className="mt-1 text-xs text-zinc-600">Attached files: {entry.evidence.map((file) => file.displayName).join(", ")}</p>}
              </li>)}
            </ol>
          )}
          <p className="mt-4 border-t border-zinc-200 pt-3 text-xs leading-5 text-zinc-600">These entries record what staff reported. They do not confirm technical completion, independent inspection, final release, payment or collection approval.</p>
        </section>

        <section className="print-section" aria-labelledby="assignment-title">
          <SectionTitle id="assignment-title" number={hasFindings ? "07" : "06"} title="Review and handover" />
          <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
            <Meta label="Operations review" value={order.operationsReview ? `${order.operationsReview.isCurrent ? "Current" : "Out of date"} · ${order.operationsReview.reviewedByName}` : "Not recorded"} note={order.operationsReview ? order.operationsReview.notes || undefined : undefined} />
            <Meta label="Team Lead" value={order.teamLeadAssignment?.leadName ?? "Not assigned"} note={order.teamLeadAssignment?.reason} />
            <Meta label="Supervisor" value={order.supervisorHandoff?.supervisorName ?? "Not assigned"} note={order.supervisorHandoff?.reason} />
            <Meta label="Work plan" value={order.workPlan ? `Version ${order.workPlan.revisionNumber}${order.workPlan.isCurrent ? " · current" : " · out of date"}` : "Not prepared"} note={order.workPlan?.rationale} />
          </dl>
          {order.workPlan && <p className="mt-4 text-xs leading-5 text-zinc-600">Planned by {order.workPlan.plannedBy} · {dateTime(order.workPlan.plannedAt, timeZone)}. A work plan does not authorize work to start.</p>}
        </section>

        <section className="print-section" aria-labelledby="holds-title">
          <SectionTitle id="holds-title" number={hasFindings ? "08" : "07"} title="Holds and required checks" />
          {order.holds.length === 0 ? <p className="text-sm text-zinc-700">No holds are recorded. Other required checks may still be pending.</p> : <ul className="space-y-3">
            {order.holds.map((hold) => <li key={hold.id} className="keep-together border-l-4 border-amber-600 pl-3">
              <p className="text-sm font-semibold text-zinc-950">{hold.severity === "stop" ? "Stop hold" : "Warning"} · {holdCategoryLabel(hold.category)}</p>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-6">{hold.reason}</p>
              <p className="mt-1 text-xs text-zinc-600">Recorded by {hold.openedBy} · {dateTime(hold.openedAt, timeZone)}</p>
            </li>)}
          </ul>}
          <ul className="mt-4 grid gap-2 sm:grid-cols-2">
            {order.gates.map((gate) => <li key={gate.code} className="keep-together border-t border-zinc-200 pt-2">
              <p className="text-sm font-semibold">{gate.label}: Pending</p>
              {gate.missing.length > 0 && <p className="mt-1 text-xs leading-5 text-zinc-600">Still needed: {gate.missing.join("; ")}</p>}
            </li>)}
          </ul>
        </section>

        <footer className="mt-8 border-t-2 border-zinc-900 pt-4 text-xs leading-5 text-zinc-700">
          <p className="font-semibold">Workshop service report · Not a work authorization. Staff entries are recorded statements and are not technical sign-off, independent inspection, vehicle release, payment receipt or collection approval.</p>
          <p className="mt-1">Use the live VMMS record to confirm current information before acting. This printed copy may be out of date.</p>
        </footer>
      </article>
    </main>
  );
}

function workEntryKindLabel(kind: ServiceReport["entries"][number]["kind"]) {
  return ({ finding: "Finding", test: "Test", action: "Work reported", "follow-up": "Follow-up" })[kind];
}

function workEntryResultLabel(result: ServiceReport["entries"][number]["result"]) {
  return ({ observed: "Observed", reproduced: "Reproduced", "not-reproduced": "Not reproduced", inconclusive: "Inconclusive", done: "Reported done", partial: "Partly done", pending: "Pending", blocked: "Blocked" })[result];
}

function sourceItemKindLabel(kind: SourceReportRevision["items"][number]["kind"]) {
  return ({ concern: "Reported concern", finding: "Finding", test: "Test", action: "Action taken", "follow-up": "Next step" })[kind];
}

function sourceKindLabel(kind: SourceReportRevision["sourceKind"]) {
  return ({ "client-report": "Client report", "workshop-report": "Workshop report", "external-record": "External record", other: "Other report" })[kind];
}

function sourceItemResultLabel(result: SourceReportRevision["items"][number]["result"]) {
  return ({ reported: "Reported", observed: "Observed in source", reproduced: "Reproduced in source", "not-reproduced": "Not reproduced in source", inconclusive: "Inconclusive", done: "Reported done", partial: "Partly done", pending: "Pending", blocked: "Could not proceed" })[result];
}

function Meta({ label, value, note, mono = false }: { label: string; value: string; note?: string | undefined; mono?: boolean }) {
  return <div className="min-w-0"><dt className="text-xs font-semibold uppercase tracking-wide text-zinc-600">{label}</dt><dd className={`mt-1 break-words text-sm font-medium text-zinc-900 ${mono ? "font-mono tabular-nums" : ""}`}>{value}</dd>{note && <dd className="mt-1 whitespace-pre-wrap text-xs leading-5 text-zinc-600">{note}</dd>}</div>;
}

function SectionTitle({ id, number, title }: { id: string; number: string; title: string }) {
  return <h2 id={id} className="mb-4 flex items-baseline gap-3 border-b border-zinc-300 pb-2 text-base font-semibold text-zinc-950"><span className="font-mono text-xs text-zinc-500">{number}</span>{title}</h2>;
}

function ownerStateLabel(state: NonNullable<WorkOrder["owner"]>["state"]) {
  return ({ reported: "Reported · not verified", verified: "Verified", rejected: "Rejected", superseded: "Replaced by newer information" })[state];
}

function warrantyLabel(state: WorkOrder["warrantyStatusAtBooking"]) {
  return ({ confirmed: "Confirmed", "not-confirmed": "Not confirmed", unknown: "Unknown" } as const)[state ?? "unknown"];
}

function evidenceStateLabel(state: WorkOrder["evidence"][number]["state"]) {
  return ({ pending: "Pending scan", quarantined: "Quarantined", accepted: "Accepted", rejected: "Rejected" })[state];
}

function holdCategoryLabel(category: WorkOrder["holds"][number]["category"]) {
  return ({ safety: "Safety", approval: "Approval", parts: "Parts", equipment: "Equipment", competency: "Skills", other: "Other" })[category];
}

function intakeFactTitle(fact: WorkOrder["intakeFacts"][number]["fact"]) {
  switch (fact.kind) {
    case "condition-observation": return `Condition · ${fact.area}`;
    case "damage-observation": return `Damage · ${fact.area}`;
    case "accessory-observation": return "Accessories";
    case "key-observation": return "Keys";
    case "fuel-reading": return "Fuel reading";
    case "custody-observation": return "Vehicle or key handover";
    case "safety-observation": return "Safety observation";
  }
}

function intakeFactDescription(fact: WorkOrder["intakeFacts"][number]["fact"]) {
  return fact.kind === "fuel-reading" ? `${fact.value.toLocaleString("en-GH")} ${fact.unit} · ${fact.observation}` : fact.description;
}

function describeObservation(observation: DiagnosticObservation): string {
  switch (observation.kind) {
    case "dtc": return `Fault code ${observation.code}${observation.system ? ` · ${observation.system}` : ""}${observation.status ? ` · ${observation.status}` : ""}${observation.freezeFrame?.length ? ` · Snapshot: ${observation.freezeFrame.map((item) => `${item.name} ${item.value}${item.unit ? ` ${item.unit}` : ""}`).join(", ")}` : ""}`;
    case "software-version": return `${observation.component} software version ${observation.version}`;
    case "condition": return `Condition: ${observation.description}`;
    case "measurement": return `${observation.name}: ${observation.value} ${observation.unit}${observation.condition ? ` · ${observation.condition}` : ""}`;
    case "reproduction-attempt": return `Attempted under ${observation.conditions}; result: ${observation.outcome}`;
    case "procedure-reference": return `Procedure reference: ${observation.title} · ${observation.source}${observation.revision ? ` · ${observation.revision}` : ""}`;
  }
}
