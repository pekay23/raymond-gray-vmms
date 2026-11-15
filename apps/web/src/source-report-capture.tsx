import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { ApiError, request, sourceReportHistorySchema, sourceReportInputSchema, sourceReportsPath } from "./api";
import type { SourceReportInput, SourceReportRevision, WorkOrder } from "./api";
import { useStaff } from "./workspace";
import { Button, Failure, Loading, dateTime, useToast } from "./ui";

type SourceKind = SourceReportInput["sourceKind"];
type EntryKind = "concern" | "finding" | "test" | "action" | "follow-up";
type EntryDraft = { kind: EntryKind; result: string; summary: string; detail: string; date: string; concern: string; complaintId: string };
type FormDraft = { sourceKind: SourceKind; title: string; sourceDate: string; sourceEvidenceId: string; entries: EntryDraft[]; correcting: SourceReportRevision | null; correctionReason: string };

const resultOptions: Record<EntryKind, Array<[string, string]>> = {
  concern: [["reported", "Reported"]],
  finding: [["observed", "Observed"], ["inconclusive", "Inconclusive"]],
  test: [["reproduced", "Reproduced"], ["not-reproduced", "Not reproduced"], ["inconclusive", "Inconclusive"]],
  action: [["done", "Done"], ["partial", "Partly done"], ["blocked", "Could not proceed"]],
  "follow-up": [["pending", "Pending"], ["done", "Done"], ["blocked", "Blocked"]],
};

function emptyDraft(): FormDraft {
  return { sourceKind: "workshop-report", title: "", sourceDate: "", sourceEvidenceId: "", entries: [{ kind: "concern", result: "reported", summary: "", detail: "", date: "", concern: "", complaintId: "" }], correcting: null, correctionReason: "" };
}

function correctionDraft(report: SourceReportRevision): FormDraft {
  let concernNumber = 0;
  const complaintById = new Map(report.items.filter(item => item.kind === "concern" && item.complaintId).map(item => [item.complaintId!, ++concernNumber]));
  return {
    sourceKind: report.sourceKind,
    title: report.title,
    sourceDate: report.sourceDate,
    sourceEvidenceId: report.sourceEvidenceId ?? "",
    correcting: report,
    correctionReason: "",
    entries: report.items.map(item => ({
      kind: item.kind,
      result: item.result,
      summary: item.summary,
      detail: item.detail,
      date: item.sourceOccurrenceDate ?? "",
      concern: item.complaintId ? String(complaintById.get(item.complaintId) ?? "") : "",
      complaintId: item.kind === "concern" ? item.complaintId ?? "" : "",
    })),
  };
}

function resultFor(kind: EntryKind, result: string) {
  const allowed = resultOptions[kind].map(([value]) => value);
  return allowed.includes(result) ? result : allowed[0] ?? "";
}

function inputFor(draft: FormDraft, expectedVersion: number): SourceReportInput {
  const items = draft.entries.map(entry => {
    const summary = entry.summary.trim();
    const detail = entry.detail.trim();
    if (entry.kind === "concern") return { kind: "concern" as const, summary, detail, existingComplaintId: entry.complaintId || null };
    const relatedConcernOrdinal = entry.concern ? Number(entry.concern) : null;
    const common = { summary, detail, sourceOccurrenceDate: entry.date || null, relatedConcernOrdinal };
    if (entry.kind === "finding") return { ...common, kind: "finding" as const, result: resultFor("finding", entry.result) as "observed" | "inconclusive" };
    if (entry.kind === "test") return { ...common, kind: "test" as const, result: resultFor("test", entry.result) as "reproduced" | "not-reproduced" | "inconclusive" };
    if (entry.kind === "action") return { ...common, kind: "action" as const, result: resultFor("action", entry.result) as "done" | "partial" | "blocked" };
    return { ...common, kind: "follow-up" as const, result: resultFor("follow-up", entry.result) as "pending" | "done" | "blocked" };
  });
  return sourceReportInputSchema.parse({
    expectedVersion,
    sourceKind: draft.sourceKind,
    title: draft.title,
    sourceDate: draft.sourceDate,
    sourceEvidenceId: draft.sourceEvidenceId || null,
    items,
    supersedesReportId: draft.correcting?.id ?? null,
    correctionReason: draft.correcting ? draft.correctionReason : null,
  });
}

function itemKindLabel(kind: EntryKind) {
  return ({ concern: "Reported concern", finding: "Finding", test: "Test", action: "Action taken", "follow-up": "Next step" })[kind];
}

function sourceKindLabel(kind: SourceKind) {
  return ({ "client-report": "Client report", "workshop-report": "Workshop report", "external-record": "External record", other: "Other report" })[kind];
}

function resultLabel(result: string) {
  return ({ reported: "Reported", observed: "Observed", reproduced: "Reproduced", "not-reproduced": "Not reproduced", inconclusive: "Inconclusive", done: "Done", partial: "Partly done", pending: "Pending", blocked: "Could not proceed" })[result] ?? result;
}

export function SourceReportCapture({ order, refresh }: { order: WorkOrder; refresh: () => void }) {
  const { site } = useStaff();
  const client = useQueryClient();
  const notify = useToast();
  const allowedRole = site.roleCodes.some(role => role === "service-advisor" || role === "head-service-centre");
  const inEntryWindow = order.workflowContext.stage === "operations-review" && !order.operationsReview && !order.workPlan;
  const [draft, setDraft] = useState<FormDraft | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const attempt = useRef<{ content: string; id: string; body: SourceReportInput } | null>(null);
  const expectedVersion = useRef(order.version);
  if (order.version > expectedVersion.current) expectedVersion.current = order.version;
  const history = useQuery({
    queryKey: ["work-order-source-reports", site.id, order.id],
    queryFn: () => request(sourceReportsPath(site.id, order.id), sourceReportHistorySchema),
    enabled: allowedRole,
  });
  const save = useMutation({
    mutationFn: (body: SourceReportInput) => {
      const content = JSON.stringify(body);
      if (!attempt.current || attempt.current.content !== content) attempt.current = { content, id: crypto.randomUUID(), body };
      return request(sourceReportsPath(site.id, order.id), sourceReportHistorySchema, { method: "POST", commandId: attempt.current.id, body: attempt.current.body });
    },
    onSuccess: result => {
      attempt.current = null;
      expectedVersion.current = result.workOrderVersion;
      client.setQueryData(["work-order-source-reports", site.id, order.id], result);
      client.invalidateQueries({ queryKey: ["work-order", site.id, order.id] });
      client.invalidateQueries({ queryKey: ["work-order-service-report", site.id, order.id] });
      client.invalidateQueries({ queryKey: ["work-orders", site.id] });
      setDraft(null);
      refresh();
      notify("Earlier report saved to this job.");
    },
    onError: error => { if (error instanceof ApiError && error.status === 409) attempt.current = null; },
  });

  if (!allowedRole) return null;
  if (history.isPending) return <section className="panel mb-6 p-5"><Loading label="Loading earlier reports" /></section>;
  if (history.isError) return <section className="panel mb-6 p-5"><Failure error={history.error} retry={() => void history.refetch()} /></section>;

  const currentIds = new Set(history.data.reports.filter(report => !history.data.reports.some(other => other.supersedesReportId === report.id)).map(report => report.id));
  const currentReports = history.data.reports.filter(report => currentIds.has(report.id));
  const acceptedSourceFiles = order.evidence.filter(file => file.state === "accepted" && file.attachedAt !== null);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft) return;
    setFormError(null);
    try { save.mutate(inputFor(draft, expectedVersion.current)); }
    catch (error) {
      if (error instanceof z.ZodError) setFormError(error.issues[0]?.message ?? "Check the report details and try again.");
      else throw error;
    }
  };
  const updateEntry = (index: number, patch: Partial<EntryDraft>) => setDraft(value => {
    if (!value) return value;
    const entries = value.entries.map((entry, entryIndex) => {
      if (entryIndex !== index) return entry;
      const updated = { ...entry, ...patch };
      if (patch.kind) {
        updated.result = resultFor(patch.kind, entry.result);
        if (patch.kind !== "concern") updated.complaintId = "";
      }
      return updated;
    });
    return { ...value, entries };
  });

  return <section className="panel mb-6 p-5 sm:p-6" aria-labelledby="source-reports-heading">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 id="source-reports-heading" className="section-title">Earlier reports</h2>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-zinc-600">Record what a client or workshop report said before Operations review. The staff member shown is the person who transcribed it, not the person who performed the work.</p>
      </div>
      {inEntryWindow && !draft && <Button type="button" onClick={() => setDraft(emptyDraft())}>Add earlier report</Button>}
    </div>

    {currentReports.length > 0 ? <ol className="mt-5 space-y-4">
      {currentReports.map(report => {
        const revisions = history.data.reports.filter(item => item.sourceDocumentId === report.sourceDocumentId).sort((left, right) => left.revision - right.revision);
        return <li key={report.id} className="rounded-lg border border-zinc-200 border-l-4 border-l-sky-700 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0"><h3 className="break-words text-sm font-semibold text-zinc-950">{report.title}</h3><p className="mt-1 text-xs text-zinc-600">{sourceKindLabel(report.sourceKind)} · {report.sourceDate} · Transcribed by {report.recordedBy} · Version {report.revision}</p><p className="mt-1 break-words text-xs text-zinc-500">{report.sourceFile ? `Source file: ${report.sourceFile.displayName}` : "Original source file not linked · Source author not recorded"}</p></div>
          {inEntryWindow && !draft && <Button variant="secondary" type="button" onClick={() => setDraft(correctionDraft(report))}>Correct transcription</Button>}
        </div>
        <ol className="mt-3 grid gap-3 sm:grid-cols-2">{report.items.map(item => <li key={item.id} className="min-w-0 border-t border-zinc-100 pt-3"><p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{itemKindLabel(item.kind)} · {resultLabel(item.result)}</p><p className="mt-1 break-words text-sm font-medium text-zinc-900">{item.summary}</p>{item.detail && <p className="mt-1 whitespace-pre-wrap [overflow-wrap:anywhere] pr-2 text-sm leading-6 text-zinc-700">{item.detail}</p>}{item.sourceOccurrenceDate && <p className="mt-1 text-xs text-zinc-500">Date stated in report: {item.sourceOccurrenceDate}</p>}{item.complaintReference && <p className="mt-1 text-xs text-zinc-500">Linked concern {item.complaintReference}</p>}</li>)}</ol>
        {report.correctionReason && <p className="mt-3 text-xs text-amber-800">Correction reason: {report.correctionReason}</p>}
        {revisions.length > 1 && <details className="mt-4 border-t border-zinc-100 pt-3"><summary className="cursor-pointer text-sm font-medium text-blue-800 underline">Show earlier transcription versions ({revisions.length - 1})</summary><ol className="mt-3 space-y-4">{revisions.slice(0, -1).map(revision => {const correction = revisions.find(next => next.supersedesReportId === revision.id); return <li key={revision.id} className="min-w-0 border-l-2 border-zinc-300 pl-3"><p className="text-xs font-semibold text-zinc-700">Superseded version {revision.revision} · Transcribed by {revision.recordedBy} · {dateTime(revision.recordedAt, site.timeZone)}</p>{correction?.correctionReason && <p className="mt-1 text-xs text-amber-800">Correction reason: {correction.correctionReason}</p>}<ul className="mt-2 space-y-2">{revision.items.map(item => <li key={item.id} className="min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere] text-sm"><span className="font-medium">{itemKindLabel(item.kind)}:</span> {item.summary}{item.detail ? ` · ${item.detail}` : ""}</li>)}</ul></li>;})}</ol></details>}
      </li>;
      })}
    </ol> : <p className="mt-4 text-sm text-zinc-600">No earlier reports have been recorded.</p>}

    {!inEntryWindow && <p className="mt-4 border-t border-zinc-100 pt-3 text-xs leading-5 text-zinc-500">Earlier reports can be added before Operations review and work planning. Later findings and work updates belong in assigned task work history.</p>}

    {draft && <form className="mt-5 border-t border-zinc-200 pt-5" onSubmit={submit}>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-medium text-zinc-800">Report title<input className="form-input mt-1 w-full" required maxLength={160} value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} /></label>
        <label className="text-sm font-medium text-zinc-800">Date on the report<input className="form-input mt-1 w-full" type="date" required value={draft.sourceDate} onChange={event => setDraft({ ...draft, sourceDate: event.target.value })} /></label>
        <label className="text-sm font-medium text-zinc-800">Report type<select aria-label="Report type" className="form-input mt-1 w-full" value={draft.sourceKind} onChange={event => setDraft({ ...draft, sourceKind: event.target.value as SourceKind })}><option value="client-report">Client report</option><option value="workshop-report">Workshop report</option><option value="external-record">External record</option><option value="other">Other</option></select></label>
        <label className="text-sm font-medium text-zinc-800 sm:col-span-2">Original report file <span className="font-normal text-zinc-500">(optional)</span><select aria-label="Original report file" className="form-input mt-1 w-full" value={draft.sourceEvidenceId} onChange={event => setDraft({ ...draft, sourceEvidenceId: event.target.value })}><option value="">No original file linked</option>{draft.sourceEvidenceId && !acceptedSourceFiles.some(file => file.evidenceId === draft.sourceEvidenceId) && <option value={draft.sourceEvidenceId} disabled>{draft.correcting?.sourceFile?.displayName ?? "Previously linked file"} · no longer available as an accepted file</option>}{acceptedSourceFiles.map(file => <option key={file.evidenceId} value={file.evidenceId}>{file.displayName}</option>)}</select><span className="mt-1 block text-xs font-normal leading-5 text-zinc-500">Choose a file already attached to this job and accepted by the security scan. A stored file does not prove who wrote the report or whether its claims are true.</span></label>
      </div>
      {draft.correcting && <label className="mt-4 block text-sm font-medium text-zinc-800">Why does this transcription need correcting?<textarea className="form-input mt-1 w-full" required maxLength={1000} rows={2} value={draft.correctionReason} onChange={event => setDraft({ ...draft, correctionReason: event.target.value })} /></label>}
      <div className="mt-5 space-y-4">
        {draft.entries.map((entry, index) => <fieldset className="min-w-0 rounded-lg border border-zinc-200 p-4" key={index}><legend className="px-1 text-sm font-semibold text-zinc-800">Report item {index + 1}</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-medium text-zinc-800">Type<select aria-label={`Type for report item ${index + 1}`} className="form-input mt-1 w-full" value={entry.kind} onChange={event => updateEntry(index, { kind: event.target.value as EntryKind })}><option value="concern">Reported concern</option><option value="finding">Finding</option><option value="test">Test</option><option value="action">Action taken</option><option value="follow-up">Next step</option></select></label>
            {entry.kind !== "concern" && <label className="text-sm font-medium text-zinc-800">Outcome<select aria-label={`Outcome for report item ${index + 1}`} className="form-input mt-1 w-full" value={entry.result} onChange={event => updateEntry(index, { result: event.target.value })}>{resultOptions[entry.kind].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
            <label className="text-sm font-medium text-zinc-800 sm:col-span-2">Short description<input aria-label={`Short description for report item ${index + 1}`} className="form-input mt-1 w-full" required maxLength={160} value={entry.summary} onChange={event => updateEntry(index, { summary: event.target.value })} /></label>
            <label className="text-sm font-medium text-zinc-800 sm:col-span-2">More detail, if stated<textarea aria-label={`More detail for report item ${index + 1}, if stated`} className="form-input mt-1 w-full" maxLength={4000} rows={3} value={entry.detail} onChange={event => updateEntry(index, { detail: event.target.value })} /></label>
            {entry.kind === "concern" ? <label className="text-sm font-medium text-zinc-800 sm:col-span-2">Link to an existing concern<select className="form-input mt-1 w-full" value={entry.complaintId} onChange={event => updateEntry(index, { complaintId: event.target.value })}><option value="">Create a concern from this report item</option>{order.complaints.map(complaint => <option key={complaint.id} value={complaint.id}>{complaint.reference} · {complaint.wording}</option>)}</select></label> : <>
              <label className="text-sm font-medium text-zinc-800">Date stated for this item<input className="form-input mt-1 w-full" type="date" value={entry.date} onChange={event => updateEntry(index, { date: event.target.value })} /></label>
              <label className="text-sm font-medium text-zinc-800">Related concern<select aria-label={`Related concern for report item ${index + 1}`} className="form-input mt-1 w-full" value={entry.concern} onChange={event => updateEntry(index, { concern: event.target.value })}><option value="">Not linked</option>{draft.entries.filter(item => item.kind === "concern").map((item, concernIndex) => <option key={concernIndex} value={String(concernIndex + 1)}>Concern {concernIndex + 1}: {item.summary || "Not yet described"}</option>)}</select></label>
            </>}
          </div>
          {draft.entries.length > 1 && <Button className="mt-3" variant="secondary" type="button" onClick={() => setDraft({ ...draft, entries: draft.entries.filter((_, itemIndex) => itemIndex !== index) })}>Remove item</Button>}
        </fieldset>)}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3"><Button variant="secondary" type="button" onClick={() => setDraft({ ...draft, entries: [...draft.entries, { kind: "finding", result: "observed", summary: "", detail: "", date: "", concern: "", complaintId: "" }] })} disabled={draft.entries.length >= 50}>Add report item</Button><Button type="submit" disabled={save.isPending}>{save.isPending ? "Saving report…" : draft.correcting ? "Save correction" : "Save report"}</Button><Button variant="secondary" type="button" onClick={() => { setDraft(null); save.reset(); }}>Cancel</Button></div>
      {(formError || save.isError) && <p role="alert" className="mt-3 text-sm text-red-800">{formError ?? save.error?.message}</p>}
      <p className="mt-3 text-xs leading-5 text-zinc-500">Only information in the source report should be entered here. Recording an earlier report does not mark repairs complete or approve work.</p>
    </form>}
  </section>;
}
