import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, ClipboardList, Search } from "lucide-react";
import { request, sitePath, vehicleServiceHistoryPath, vehicleServiceHistorySchema } from "../api";
import { useStaff } from "../workspace";
import { Badge, Button, Empty, Failure, Loading, PageHeading, dateTime, useOnline } from "../ui";

function resultLabel(value: string) {
  return value.split("-").map(part => part ? part[0]!.toUpperCase() + part.slice(1) : part).join(" ");
}

function entryTypeLabel(value: string) {
  if (value === "finding") return "Finding";
  if (value === "test") return "Test";
  if (value === "action") return "Work recorded";
  return "Follow-up";
}

export function ServiceHistory() {
  const { site } = useStaff();
  const online = useOnline();
  const [vinText, setVinText] = useState("");
  const [searchedVin, setSearchedVin] = useState("");
  const [page, setPage] = useState(1);
  const [inputError, setInputError] = useState<string | null>(null);
  const path = vehicleServiceHistoryPath(site.id, searchedVin, page, 10);
  const history = useQuery({
    queryKey: ["vehicle-service-history", site.id, searchedVin, page],
    queryFn: () => request(path, vehicleServiceHistorySchema),
    enabled: Boolean(searchedVin) && online,
    retry: false,
  });

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const vin = vinText.trim().toUpperCase();
    if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) {
      setInputError("Enter the full 17-character VIN from the vehicle or its documents.");
      return;
    }
    setInputError(null);
    setPage(1);
    setSearchedVin(vin);
  }

  return (
    <>
      <PageHeading eyebrow="Workshop records" title="Service history">
        Find previous service visits recorded at this service centre. Sales delivery and purchaser claims are not included.
      </PageHeading>

      <section className="panel mb-6" aria-labelledby="service-history-search-title">
        <div className="panel-heading">
          <div>
            <h2 id="service-history-search-title" className="section-title">Find a vehicle</h2>
            <p className="mt-1 text-sm text-zinc-600">Search by VIN. The history is limited to this service centre.</p>
          </div>
        </div>
        <form className="grid gap-4 p-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end sm:p-6" onSubmit={search}>
          <div className="min-w-0">
            <label htmlFor="service-history-vin" className="mb-1.5 block text-sm font-medium text-zinc-800">Vehicle identification number (VIN)</label>
            <input
              id="service-history-vin"
              value={vinText}
              onChange={event => { setVinText(event.target.value.toUpperCase()); setInputError(null); }}
              autoComplete="off"
              spellCheck={false}
              maxLength={17}
              className="w-full font-mono uppercase tracking-wide"
              aria-invalid={Boolean(inputError)}
              aria-describedby={inputError ? "service-history-vin-error" : "service-history-vin-help"}
            />
            {inputError
              ? <p id="service-history-vin-error" className="mt-2 text-sm text-rose-800" role="alert">{inputError}</p>
              : <p id="service-history-vin-help" className="mt-2 text-sm text-zinc-500">Use the VIN exactly as shown on the vehicle or its documents.</p>}
          </div>
          <Button type="submit" disabled={!online}>
            <Search className="size-4" aria-hidden="true" />
            Find history
          </Button>
        </form>
      </section>

      {!online && searchedVin && <p className="mb-5 rounded-md border-l-2 border-amber-500 bg-amber-50 px-4 py-3 text-sm text-amber-950" role="status">Reconnect to load service history. This record is not saved on this device.</p>}
      {history.isLoading && <Loading label="Loading service history" />}
      {history.error && <Failure error={history.error} retry={() => void history.refetch()} />}
      {history.data && !history.data.vehicle && (
        <section className="panel">
          <Empty title="No service history found at this centre">
            Check the VIN and try again. If the vehicle is new to this centre, start a new visit from Work orders.
          </Empty>
          <div className="pb-5 text-center">
            <Link className="button button-secondary" to={`${sitePath(site.id)}/work-orders`}>
              <ClipboardList className="size-4" aria-hidden="true" />
              Open work orders
            </Link>
          </div>
        </section>
      )}
      {history.data?.vehicle && (
        <div className="space-y-5">
          <section className="panel" aria-labelledby="service-history-vehicle-title">
            <div className="panel-heading">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Vehicle at this centre</p>
                <h2 id="service-history-vehicle-title" className="mt-1 text-lg font-semibold text-zinc-950">
                  {history.data.vehicle.make} {history.data.vehicle.model}{history.data.vehicle.variant ? ` · ${history.data.vehicle.variant}` : ""}
                </h2>
              </div>
              <Badge tone="green">VIN found</Badge>
            </div>
            <dl className="grid gap-4 p-5 text-sm sm:grid-cols-2 sm:p-6">
              <div><dt className="text-xs font-medium text-zinc-500">VIN</dt><dd className="mt-1 break-all font-mono">{history.data.vehicle.vin}</dd></div>
              <div><dt className="text-xs font-medium text-zinc-500">Registration</dt><dd className="mt-1">{history.data.vehicle.registration || "Not recorded"}</dd></div>
              <div><dt className="text-xs font-medium text-zinc-500">Powertrain</dt><dd className="mt-1">{history.data.vehicle.powertrain || "Not recorded"}</dd></div>
              <div><dt className="text-xs font-medium text-zinc-500">Visits recorded here</dt><dd className="mt-1">{history.data.pagination.totalItems}</dd></div>
            </dl>
          </section>

          <section className="space-y-4" aria-labelledby="service-history-visits-title">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 id="service-history-visits-title" className="section-title">Service visits</h2>
                <p className="mt-1 text-sm text-zinc-600">Reported concerns and work notes saved to each job.</p>
              </div>
              {history.data.pagination.totalItems > 0 && <p role="status" className="text-sm text-zinc-600">Page {history.data.pagination.page} of {Math.max(1, history.data.pagination.totalPages)} · {history.data.pagination.totalItems} visits</p>}
            </div>
            {history.data.items.length === 0 ? (
              <section className="panel"><Empty title="No service visits recorded">This vehicle is known here, but there are no service visit records to show.</Empty></section>
            ) : history.data.items.map(visit => (
              <article key={visit.workOrderId} className="panel min-w-0 overflow-hidden">
                <div className="panel-heading">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{dateTime(visit.openedAt, site.timeZone)}</p>
                    <h3 className="mt-1 font-mono text-lg font-semibold text-zinc-950">{visit.reference}</h3>
                  </div>
                  <Link className="button button-secondary shrink-0" to={`${sitePath(site.id)}/work-orders/${visit.workOrderId}`}>
                    Open job <ArrowRight className="size-4" aria-hidden="true" />
                  </Link>
                </div>
                <div className="space-y-5 p-5 sm:p-6">
                  <dl className="grid gap-4 text-sm sm:grid-cols-2">
                    <div><dt className="text-xs font-medium text-zinc-500">Odometer at visit</dt><dd className="mt-1">{visit.odometerKm.toLocaleString("en-GH")} km</dd></div>
                    <div><dt className="text-xs font-medium text-zinc-500">Reported concerns</dt><dd className="mt-1">{visit.complaints.length}</dd></div>
                  </dl>
                  <div>
                    <h4 className="text-sm font-semibold text-zinc-900">Reported concerns</h4>
                    {visit.complaints.length
                      ? <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-zinc-700">{visit.complaints.map((complaint, index) => <li key={`${visit.workOrderId}-complaint-${index}`}>{complaint}</li>)}</ul>
                      : <p className="mt-2 text-sm text-zinc-500">No concerns recorded.</p>}
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-zinc-900">Work notes</h4>
                    {visit.workEntries.length ? (
                      <ol className="mt-3 space-y-3">
                        {visit.workEntries.map(entry => (
                          <li key={entry.id} className="min-w-0 border-l-2 border-slate-300 pl-4">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-mono text-xs font-semibold text-zinc-600">{entry.taskReference}</span>
                              <span className="text-sm font-semibold text-zinc-900">{entry.taskTitle}</span>
                              <Badge>{entryTypeLabel(entry.kind)} · {resultLabel(entry.result)}</Badge>
                              {entry.supersedesEntryId && <Badge tone="warning">Correction</Badge>}
                            </div>
                            <p className="mt-2 text-sm font-medium text-zinc-800">{entry.summary}</p>
                            <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-zinc-600">{entry.detail}</p>
                            <p className="mt-2 text-xs text-zinc-500">Recorded by {entry.actorName} · {dateTime(entry.recordedAt, site.timeZone)}</p>
                            {entry.correctionReason && <p className="mt-1 text-xs text-amber-800">Correction reason: {entry.correctionReason}</p>}
                          </li>
                        ))}
                      </ol>
                    ) : <p className="mt-2 text-sm text-zinc-500">No technician work notes have been recorded for this job.</p>}
                  </div>
                </div>
              </article>
            ))}
            {history.data.pagination.totalPages > 1 && (
              <nav className="flex flex-wrap items-center justify-between gap-3" aria-label="Service history pages">
                <Button variant="secondary" disabled={history.data.pagination.page <= 1} onClick={() => setPage(current => Math.max(1, current - 1))}>
                  <ArrowLeft className="size-4" aria-hidden="true" /> Previous
                </Button>
                <Button variant="secondary" disabled={history.data.pagination.page >= history.data.pagination.totalPages} onClick={() => setPage(current => Math.min(history.data.pagination.totalPages, current + 1))}>
                  Next <ArrowRight className="size-4" aria-hidden="true" />
                </Button>
              </nav>
            )}
          </section>
          <p className="rounded-md border-l-2 border-amber-500 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950">
            These are recorded workshop notes. They do not confirm a repair was approved, signed off, or that a vehicle was released.
          </p>
        </div>
      )}
    </>
  );
}
