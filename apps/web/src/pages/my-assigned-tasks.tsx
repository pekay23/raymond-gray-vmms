import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, ClipboardCheck, Clock3, MessageSquareText, Search, Square, X } from "lucide-react";
import { Link } from "react-router-dom";
import { activeTaskLaborSessionSchema, ApiError, myAssignedTasksPath, myAssignedTasksSchema, myTaskActivityPath, myTaskLaborSessionPath, myTaskLaborStartPath, myTaskLaborStopPath, myTaskWorkEntriesPath, myTaskWorkEvidencePath, request, taskActivityHistorySchema, taskActivityResultSchema, taskLaborSessionSchema, taskWorkEntryHistorySchema, taskWorkEntryResultSchema, taskWorkEvidenceOptionsSchema } from "../api";
import { useStaff } from "../workspace";
import { Badge, Button, Empty, Failure, Loading, PageHeading, dateTime, useOnline } from "../ui";
import { instantToSiteDateTimeInput, siteDateTimeInputToInstant } from "../formatting";
import { TaskWorkEvidence } from "../task-work-evidence";
import { TaskChecklistOutcomes } from "../task-checklist-outcomes";

type AssignedTask = (typeof myAssignedTasksSchema)['_output']['items'][number];
type TaskActivityItem = (typeof taskActivityHistorySchema)['_output']['items'][number];
type WorkEntry = (typeof taskWorkEntryHistorySchema)['_output']['items'][number];
type WorkEntryKind = "finding" | "test" | "action" | "follow-up";
type WorkEntryResult = "observed" | "reproduced" | "not-reproduced" | "inconclusive" | "done" | "partial" | "pending" | "blocked";

const defaultWorkResult: Record<WorkEntryKind, WorkEntryResult> = {
  finding: "observed",
  test: "inconclusive",
  action: "done",
  "follow-up": "pending",
};

const workResultOptions: Record<WorkEntryKind, { value: WorkEntryResult; label: string; disabled?: boolean }[]> = {
  finding: [{ value: "observed", label: "Observed" }, { value: "inconclusive", label: "Inconclusive" }],
  test: [{ value: "reproduced", label: "Concern reproduced", disabled: true }, { value: "not-reproduced", label: "Concern not reproduced", disabled: true }, { value: "inconclusive", label: "Inconclusive", disabled: true }],
  action: [{ value: "done", label: "Done", disabled: true }, { value: "partial", label: "Partly done", disabled: true }, { value: "blocked", label: "Blocked", disabled: true }],
  "follow-up": [{ value: "pending", label: "Still needed" }, { value: "done", label: "Done", disabled: true }, { value: "blocked", label: "Blocked" }],
};

function TaskActivity({ task, siteId, timeZone }: { task: AssignedTask; siteId: string; timeZone: string }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"update" | "work" | "declaration">("update");
  const [workPage, setWorkPage] = useState(1);
  const [evidencePage, setEvidencePage] = useState(1);
  const [selectedEvidenceIds, setSelectedEvidenceIds] = useState<string[]>([]);
  const [selectedEvidenceNames, setSelectedEvidenceNames] = useState<Record<string, string>>({});
  const [entryType, setEntryType] = useState<"acknowledgement" | "progress" | "request" | "comment">("progress");
  const [progressState, setProgressState] = useState<"working" | "waiting" | "blocked">("working");
  const [requestType, setRequestType] = useState<"help" | "parts" | "information" | "access" | "evidence" | "supervisor-review">("help");
  const [note, setNote] = useState("");
  const [declarationActions, setDeclarationActions] = useState("");
  const [declarationChecks, setDeclarationChecks] = useState("");
  const [declarationOutcome, setDeclarationOutcome] = useState<"reported-complete" | "reported-incomplete" | "blocked">("reported-complete");
  const [declarationRemaining, setDeclarationRemaining] = useState("");
  const [activityRetryRequired, setActivityRetryRequired] = useState(false);
  const [workKind, setWorkKind] = useState<WorkEntryKind>("finding");
  const [workResult, setWorkResult] = useState<WorkEntryResult>("observed");
  const [workSummary, setWorkSummary] = useState("");
  const [workDetail, setWorkDetail] = useState("");
  const [observedAt, setObservedAt] = useState("");
  const [correction, setCorrection] = useState<WorkEntry | null>(null);
  const [correctionReason, setCorrectionReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [workRetryRequired, setWorkRetryRequired] = useState(false);
  const queryClient = useQueryClient();
  const path = myTaskActivityPath(siteId, task.workOrderId, task.taskId);
  const activity = useQuery({
    queryKey: ["my-task-activity", siteId, task.workOrderId, task.taskId, task.assignmentRevision],
    queryFn: () => request(path, taskActivityHistorySchema),
    enabled: open,
  });
  const workEntriesPath = myTaskWorkEntriesPath(siteId, task.workOrderId, task.taskId, workPage, 25);
  const workEntries = useQuery({
    queryKey: ["my-task-work-entries", siteId, task.workOrderId, task.taskId, task.assignmentRevision, workPage],
    queryFn: () => request(workEntriesPath, taskWorkEntryHistorySchema),
    enabled: open && mode === "work",
  });
  const workEvidencePath = myTaskWorkEvidencePath(siteId, task.workOrderId, task.taskId, evidencePage, 50);
  const workEvidence = useQuery({
    queryKey: ["my-task-work-evidence", siteId, task.workOrderId, task.taskId, task.assignmentRevision, evidencePage],
    queryFn: () => request(workEvidencePath, taskWorkEvidenceOptionsSchema),
    enabled: open && mode === "work",
  });
  useEffect(() => {
    if (!workEvidence.data) return;
    setSelectedEvidenceNames(current => ({
      ...current,
      ...Object.fromEntries(workEvidence.data.items.map(item => [item.evidenceId, item.displayName])),
    }));
  }, [workEvidence.data]);
  const attempt = useRef<{ id: string; body: Record<string, unknown> } | null>(null);
  const save = useMutation({
    mutationFn: () => {
      if (!attempt.current) {
        attempt.current = {
          id: crypto.randomUUID(),
          body: {
            expectedWorkPlanRevisionId: task.workPlanRevisionId,
            expectedAssignmentRevision: task.assignmentRevision,
            entryType: mode === "declaration" ? "request" : entryType,
            progressState: mode !== "declaration" && entryType === "progress" ? progressState : null,
            requestType: mode === "declaration" ? "supervisor-review" : entryType === "request" ? requestType : null,
            completionDeclaration: mode === "declaration" ? {
              actionsSummary: declarationActions.trim(), checksSummary: declarationChecks.trim(),
              outcome: declarationOutcome, remainingWork: declarationRemaining.trim(),
            } : null,
            note: mode === "declaration" ? "Worker report submitted for Supervisor review." : note.trim(),
          },
        };
      }
      return request(path, taskActivityResultSchema, {
        method: "POST", commandId: attempt.current.id, body: attempt.current.body,
      });
    },
    onSuccess: async () => {
      attempt.current = null;
      setActivityRetryRequired(false);
      setNote("");
      setDeclarationActions("");
      setDeclarationChecks("");
      setDeclarationOutcome("reported-complete");
      setDeclarationRemaining("");
      setMessage(mode === "declaration" ? "Work report sent to the Supervisor for review. The task is not signed off." : "Task update saved.");
      await queryClient.invalidateQueries({ queryKey: ["my-task-activity", siteId, task.workOrderId, task.taskId] });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status < 500) {
        attempt.current = null;
        setActivityRetryRequired(false);
      } else setActivityRetryRequired(true);
      setMessage(error instanceof Error ? error.message : "The task update could not be saved.");
    },
  });
  const workAttempt = useRef<{ id: string; body: Record<string, unknown> } | null>(null);
  function workObservedInstant() {
    if (!observedAt) return null;
    if (correction?.observedAt && observedAt === toLocalDateTime(correction.observedAt, timeZone)) return correction.observedAt;
    return siteDateTimeInputToInstant(observedAt, timeZone);
  }
  const saveWorkEntry = useMutation({
    mutationFn: () => {
      if (!workAttempt.current) {
        workAttempt.current = {
          id: crypto.randomUUID(),
          body: {
            expectedWorkPlanRevisionId: task.workPlanRevisionId,
            expectedAssignmentRevision: task.assignmentRevision,
            kind: workKind,
            result: workResult,
            summary: workSummary.trim(),
            detail: workDetail.trim(),
            observedAt: workObservedInstant(),
            evidenceIds: selectedEvidenceIds,
            supersedesEntryId: correction?.id ?? null,
            correctionReason: correction ? correctionReason.trim() : null,
          },
        };
      }
      return request(workEntriesPath, taskWorkEntryResultSchema, {
        method: "POST", commandId: workAttempt.current.id, body: workAttempt.current.body,
      });
    },
    onSuccess: async () => {
      workAttempt.current = null;
      setWorkRetryRequired(false);
      setWorkSummary("");
      setWorkDetail("");
      setObservedAt("");
      setSelectedEvidenceIds([]);
      setSelectedEvidenceNames({});
      setEvidencePage(1);
      setCorrection(null);
      setCorrectionReason("");
      setMessage(correction ? "Correction saved. The earlier entry remains in history." : "Work entry saved.");
      await queryClient.invalidateQueries({ queryKey: ["my-task-work-entries", siteId, task.workOrderId, task.taskId] });
      await queryClient.invalidateQueries({ queryKey: ["my-task-work-evidence", siteId, task.workOrderId, task.taskId] });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== 408) {
        workAttempt.current = null;
        setWorkRetryRequired(false);
      } else {
        setWorkRetryRequired(true);
        const body = workAttempt.current?.body;
        if (body) {
          setWorkKind(body.kind as WorkEntryKind);
          setWorkResult(body.result as WorkEntryResult);
          setWorkSummary(String(body.summary));
          setWorkDetail(String(body.detail));
          setSelectedEvidenceIds(Array.isArray(body.evidenceIds) ? body.evidenceIds.filter((id): id is string => typeof id === "string") : []);
          const occurred = body.observedAt;
          setObservedAt(typeof occurred === "string" ? toLocalDateTime(occurred, timeZone) : "");
        }
      }
      setMessage(error instanceof Error ? error.message : "The work entry could not be saved.");
    },
  });

  function submitWorkEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    try { workObservedInstant(); } catch (error) {
      setMessage(error instanceof Error ? error.message : "Enter a valid service-centre time.");
      return;
    }
    saveWorkEntry.mutate();
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    save.mutate();
  }

  function submitDeclaration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    save.mutate();
  }

  function beginCorrection(item: WorkEntry) {
    setCorrection(item);
    setCorrectionReason("");
    setWorkKind(item.kind);
    setWorkResult(item.result);
    setWorkSummary(item.summary);
    setWorkDetail(item.detail);
    setObservedAt(item.observedAt ? toLocalDateTime(item.observedAt, timeZone) : "");
    setSelectedEvidenceIds(item.evidenceIds);
    setEvidencePage(1);
    setMessage(null);
    setMode("work");
    setWorkPage(1);
  }

  function cancelCorrection() {
    setCorrection(null);
    setCorrectionReason("");
    setWorkSummary("");
    setWorkDetail("");
    setObservedAt("");
    setSelectedEvidenceIds([]);
    setMessage(null);
  }

  function toggleEvidenceSelection(evidenceId: string, displayName: string, selected: boolean) {
    setMessage(null);
    if (selected) {
      if (selectedEvidenceIds.includes(evidenceId)) return;
      if (selectedEvidenceIds.length >= 20) {
        setMessage("Choose no more than 20 files for one work entry.");
        return;
      }
      setSelectedEvidenceIds(current => current.includes(evidenceId) ? current : [...current, evidenceId]);
      setSelectedEvidenceNames(current => ({ ...current, [evidenceId]: displayName }));
      return;
    }
    setSelectedEvidenceIds(current => current.filter(id => id !== evidenceId));
  }

  return (
    <section className="mt-5 border-t border-zinc-200 pt-4" aria-label={`Updates and work history for ${task.taskReference}`}>
      <Button variant="secondary" type="button" onClick={() => setOpen(value => !value)} aria-expanded={open}>
        <MessageSquareText className="size-4" aria-hidden="true" /> {open ? "Hide task updates" : "Update task"}
      </Button>
      {open && (
        <div className="mt-4">
          <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label={`Task record type for ${task.taskReference}`}>
            <Button variant={mode === "update" ? "primary" : "secondary"} type="button" disabled={saveWorkEntry.isPending || workRetryRequired || save.isPending || activityRetryRequired} aria-pressed={mode === "update"} onClick={() => { setMode("update"); setMessage(null); }}>Progress update</Button>
            <Button variant={mode === "work" ? "primary" : "secondary"} type="button" disabled={saveWorkEntry.isPending || workRetryRequired || save.isPending || activityRetryRequired} aria-pressed={mode === "work"} onClick={() => { setMode("work"); setWorkPage(1); setMessage(null); }}>Record work</Button>
            <Button variant={mode === "declaration" ? "primary" : "secondary"} type="button" disabled={saveWorkEntry.isPending || workRetryRequired || save.isPending || activityRetryRequired} aria-pressed={mode === "declaration"} onClick={() => { setMode("declaration"); setMessage(null); }}>Send work for review</Button>
          </div>
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          {mode === "declaration" ? <form className="grid min-w-0 gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4" onSubmit={submitDeclaration}>
            <div>
              <h4 className="font-semibold text-zinc-950">Report this task ready for Supervisor review</h4>
              <p className="mt-1 text-sm leading-6 text-zinc-700">Summarize the work you recorded, the checks and results, and anything still outstanding. VMMS links this report to your current assignment's work entries.</p>
              <p className="mt-2 text-sm font-medium text-amber-950">This is your report only. It does not authorize work, approve technical completion, clear a hold or release the vehicle.</p>
            </div>
            <div><label htmlFor={`declaration-actions-${task.taskId}`}>Actions recorded</label><textarea id={`declaration-actions-${task.taskId}`} required maxLength={4000} rows={3} value={declarationActions} disabled={save.isPending || activityRetryRequired} onChange={event => setDeclarationActions(event.target.value)} /></div>
            <div><label htmlFor={`declaration-checks-${task.taskId}`}>Checks and results</label><textarea id={`declaration-checks-${task.taskId}`} required maxLength={4000} rows={3} value={declarationChecks} disabled={save.isPending || activityRetryRequired} onChange={event => setDeclarationChecks(event.target.value)} /><p className="field-hint">State what was checked, the result, or why a check was not done.</p></div>
            <div><label htmlFor={`declaration-outcome-${task.taskId}`}>Your reported outcome</label><select id={`declaration-outcome-${task.taskId}`} value={declarationOutcome} disabled={save.isPending || activityRetryRequired} onChange={event => setDeclarationOutcome(event.target.value as typeof declarationOutcome)}><option value="reported-complete">I report the assigned work is complete</option><option value="reported-incomplete">I report some work remains</option><option value="blocked">I could not complete the assigned work</option></select></div>
            <div><label htmlFor={`declaration-remaining-${task.taskId}`}>Remaining work or concerns</label><textarea id={`declaration-remaining-${task.taskId}`} required maxLength={2000} rows={2} value={declarationRemaining} disabled={save.isPending || activityRetryRequired} onChange={event => setDeclarationRemaining(event.target.value)} /><p className="field-hint">If nothing remains, say so. The Supervisor still checks the task and required evidence.</p></div>
            {activityRetryRequired && <p className="rounded-md border border-amber-400 bg-white px-3 py-2 text-sm text-amber-950" role="status">The save result is uncertain. Your original report is locked. Retry it with the same command to avoid a duplicate.</p>}
            {message && <p role="status" className="text-sm text-zinc-700">{message}</p>}
            {save.isError && <p role="alert" className="text-sm text-red-800">Refresh your assignments if this task has changed. {message}</p>}
            <Button type="submit" disabled={save.isPending || (!activityRetryRequired && (!declarationActions.trim() || !declarationChecks.trim() || !declarationRemaining.trim()))}>{save.isPending ? "Sending…" : activityRetryRequired ? "Retry saved report" : "Send report for Supervisor review"}</Button>
          </form> : mode === "update" ? <form className="grid min-w-0 gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-4" onSubmit={submit}>
            <p className="text-sm text-zinc-700">Use this for progress, help, a Supervisor review request or handover notes.</p>
            <div>
              <label htmlFor={`task-entry-type-${task.taskId}`}>Update type</label>
              <select id={`task-entry-type-${task.taskId}`} value={entryType} disabled={save.isPending || activityRetryRequired} onChange={event => setEntryType(event.target.value as typeof entryType)}>
                <option value="acknowledgement">Acknowledge assignment</option>
                <option value="progress">Progress update</option>
                <option value="request">Request help or resources</option>
                <option value="comment">Comment</option>
              </select>
            </div>
            {entryType === "progress" && (
              <div>
                <label htmlFor={`task-progress-state-${task.taskId}`}>Progress status</label>
                <select id={`task-progress-state-${task.taskId}`} value={progressState} disabled={save.isPending || activityRetryRequired} onChange={event => setProgressState(event.target.value as typeof progressState)}>
                  <option value="working">Working</option><option value="waiting">Waiting</option><option value="blocked">Blocked</option>
                </select>
              </div>
            )}
            {entryType === "request" && (
              <div>
                <label htmlFor={`task-request-type-${task.taskId}`}>What do you need?</label>
                <select id={`task-request-type-${task.taskId}`} value={requestType} disabled={save.isPending || activityRetryRequired} onChange={event => setRequestType(event.target.value as typeof requestType)}>
                  <option value="help">Help</option><option value="parts">Parts</option><option value="information">Information</option><option value="access">Access</option><option value="evidence">Evidence</option><option value="supervisor-review">Ask Supervisor to review work</option>
                </select>
                {requestType === "supervisor-review" && <p className="mt-1 text-sm text-zinc-600">This sends a review request. It does not mark the task or job complete.</p>}
              </div>
            )}
            <div>
              <label htmlFor={`task-note-${task.taskId}`}>{entryType === "request" ? "Describe your request" : "Note"}</label>
              <textarea id={`task-note-${task.taskId}`} required maxLength={1500} rows={3} value={note} disabled={save.isPending || activityRetryRequired} onChange={event => setNote(event.target.value)} />
            </div>
            {activityRetryRequired && <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950" role="status">The save result is uncertain. The original update is locked. Retry it with the same command to avoid a duplicate.</p>}
            {message && <p role="status" className="text-sm text-zinc-700">{message}</p>}
            {save.isError && <p role="alert" className="text-sm text-red-800">Refresh your assignments if this task has changed. {message}</p>}
            <Button type="submit" disabled={save.isPending || (!activityRetryRequired && !note.trim())}>{save.isPending ? "Saving…" : activityRetryRequired ? "Retry saved update" : "Save update"}</Button>
          </form> : <form className="grid min-w-0 gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-4" onSubmit={submitWorkEntry}>
            {correction && <div className="rounded-md border-l-4 border-amber-500 bg-amber-50 px-3 py-2" role="status">
              <h4 className="font-semibold text-amber-950">Correcting a recorded entry</h4>
              <p className="mt-1 text-sm leading-5 text-amber-950">The original entry will remain in the work history. This adds a new correction and does not approve or sign off the work.</p>
            </div>}
            <p className="text-sm leading-6 text-zinc-700">Record observations and open follow-ups for this task. Tests, repair actions and marking a technical follow-up done stay unavailable until the job has an approved scope, effective vehicle instructions, a matching qualification and signed task authority.</p>
            <div>
              <label htmlFor={`work-kind-${task.taskId}`}>Record type</label>
              <select id={`work-kind-${task.taskId}`} value={workKind} disabled={saveWorkEntry.isPending || workRetryRequired} onChange={event => { const next = event.target.value as WorkEntryKind; setWorkKind(next); setWorkResult(defaultWorkResult[next]); }}>
                <option value="finding">Finding</option><option value="test" disabled>Test · authorization unavailable</option><option value="action" disabled>Work done · authorization unavailable</option><option value="follow-up">Follow-up</option>
              </select>
            </div>
            <div>
              <label htmlFor={`work-result-${task.taskId}`}>Result</label>
              <select id={`work-result-${task.taskId}`} value={workResult} disabled={saveWorkEntry.isPending || workRetryRequired} onChange={event => setWorkResult(event.target.value as WorkEntryResult)}>
                {workResultOptions[workKind].map(option => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}{option.disabled ? " · authorization unavailable" : ""}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor={`work-summary-${task.taskId}`}>Short summary</label>
              <input id={`work-summary-${task.taskId}`} required maxLength={160} value={workSummary} disabled={saveWorkEntry.isPending || workRetryRequired} onChange={event => setWorkSummary(event.target.value)} />
            </div>
            <div>
              <label htmlFor={`work-detail-${task.taskId}`}>What happened?</label>
              <textarea id={`work-detail-${task.taskId}`} required maxLength={4000} rows={4} value={workDetail} disabled={saveWorkEntry.isPending || workRetryRequired} onChange={event => setWorkDetail(event.target.value)} />
            </div>
            {correction && <div>
              <label htmlFor={`work-correction-reason-${task.taskId}`}>Why is a correction needed?</label>
              <textarea id={`work-correction-reason-${task.taskId}`} required maxLength={1000} rows={2} value={correctionReason} disabled={saveWorkEntry.isPending || workRetryRequired} onChange={event => setCorrectionReason(event.target.value)} />
              <p className="field-hint">Explain what was inaccurate or missing. The earlier entry will not be replaced.</p>
            </div>}
            <div>
              <label htmlFor={`work-observed-at-${task.taskId}`}>When did it happen? <span className="font-normal text-zinc-500">Optional</span></label>
              <input id={`work-observed-at-${task.taskId}`} type="datetime-local" value={observedAt} disabled={saveWorkEntry.isPending || workRetryRequired} onChange={event => setObservedAt(event.target.value)} />
              <p className="field-hint">Service-centre local time · {timeZone}. Leave blank if unknown; VMMS records when you add this note.</p>
            </div>
            <fieldset className="grid min-w-0 gap-3 rounded-md border border-zinc-200 bg-white p-3">
              <legend className="px-1 text-sm font-semibold text-zinc-900">Files for this work entry</legend>
              <p className="text-sm leading-5 text-zinc-700">Choose accepted job files or files already uploaded for this task. New task files are linked only when this work entry is saved.</p>
              <p className="text-xs text-zinc-600" aria-live="polite">{selectedEvidenceIds.length} of 20 files selected</p>
              {selectedEvidenceIds.length > 0 && <ul className="grid gap-1 border-l-2 border-blue-700 pl-3" aria-label="Selected files">
                {selectedEvidenceIds.map(id => <li key={id} className="break-words text-xs text-zinc-700">{selectedEvidenceNames[id] ?? "Previously linked file"}</li>)}
              </ul>}
              {workEvidence.isPending ? <Loading label="Loading attached files" /> : workEvidence.isError ? (
                <Failure error={workEvidence.error} retry={() => { void workEvidence.refetch(); }} />
              ) : workEvidence.data.items.length === 0 ? (
                <p className="rounded-md border border-dashed border-zinc-300 px-3 py-4 text-sm text-zinc-600">No accepted files are available for this task. You can save the work entry without files.</p>
              ) : <>
                <ul className="grid gap-2 sm:grid-cols-2">
                  {workEvidence.data.items.map(item => {
                    const checked = selectedEvidenceIds.includes(item.evidenceId);
                    return <li key={item.evidenceId} className="min-w-0 rounded-md border border-zinc-200 p-3">
                      <label className="flex min-w-0 items-start gap-3">
                        <input type="checkbox" aria-label={`Attach ${item.displayName}`} checked={checked}
                          disabled={saveWorkEntry.isPending || workRetryRequired || (!checked && selectedEvidenceIds.length >= 20)}
                          onChange={event => toggleEvidenceSelection(item.evidenceId, item.displayName, event.target.checked)} />
                        <span className="min-w-0 break-words text-sm font-medium text-zinc-900">{item.displayName}
                          <span className="mt-1 block text-xs font-normal text-zinc-600">{item.state === "ready" ? "Security check passed · ready for this task" : "Already attached to this task or job"} · {item.mediaType} · {dateTime(item.uploadedAt, timeZone)}</span>
                        </span>
                      </label>
                    </li>;
                  })}
                </ul>
                {workEvidence.data.pagination.totalPages > 1 && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200 pt-3">
                  <p className="text-xs text-zinc-600" aria-live="polite">Attached files page {workEvidence.data.pagination.page} of {workEvidence.data.pagination.totalPages}</p>
                  <div className="flex gap-2">
                    <Button variant="secondary" type="button" disabled={saveWorkEntry.isPending || workRetryRequired || workEvidence.data.pagination.page <= 1 || workEvidence.isFetching}
                      onClick={() => setEvidencePage(page => Math.max(1, page - 1))}>Previous files</Button>
                    <Button variant="secondary" type="button" disabled={saveWorkEntry.isPending || workRetryRequired || workEvidence.data.pagination.page >= workEvidence.data.pagination.totalPages || workEvidence.isFetching}
                      onClick={() => setEvidencePage(page => page + 1)}>Next files</Button>
                  </div>
                </div>}
              </>}
            </fieldset>
            <TaskWorkEvidence
              task={task}
              siteId={siteId}
              disabled={saveWorkEntry.isPending || workRetryRequired}
              linkedEvidenceIds={workEvidence.data?.items.filter(item => item.state === "attached").map(item => item.evidenceId) ?? []}
            />
            {workRetryRequired && <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950" role="status">The save result is uncertain. The fields are locked to the original entry. Choose “Retry saved work entry” to safely repeat that submission.</p>}
            {message && <p role="status" className="text-sm text-zinc-700">{message}</p>}
            {saveWorkEntry.isError && <p role="alert" className="text-sm text-red-800">Refresh your assignments if this task has changed. {message}</p>}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={saveWorkEntry.isPending || (!workRetryRequired && (!workSummary.trim() || !workDetail.trim() || (correction !== null && !correctionReason.trim())))}>{saveWorkEntry.isPending ? "Saving…" : workRetryRequired ? "Retry saved work entry" : correction ? "Save correction" : "Save work entry"}</Button>
              {correction && <Button variant="secondary" type="button" disabled={saveWorkEntry.isPending || workRetryRequired} onClick={cancelCorrection}>Cancel correction</Button>}
            </div>
          </form>}
          <div className="min-w-0">
            <h4 className="font-semibold text-zinc-900">{mode === "work" ? "Work history" : "Update history"}</h4>
            {mode !== "work" ? activity.isPending ? <Loading label="Loading task updates" /> : activity.isError ? <Failure error={activity.error} retry={() => { void activity.refetch(); }} /> : activity.data.items.length === 0 ? (
              <p className="mt-2 text-sm text-zinc-600">No updates have been added to this task.</p>
            ) : (
              <ol className="mt-2 space-y-3 border-l border-zinc-300 pl-4">
                {activity.data.items.map(item => (
                  <li key={item.id} className="relative min-w-0">
                    <span className="absolute -left-[1.35rem] top-1 size-2 rounded-full bg-sky-700" aria-hidden="true" />
                    <p className="font-medium text-zinc-900">{taskActivityLabel(item)}</p>
                    <p className="mt-1 break-words text-sm text-zinc-700">{item.note}</p>
                    {item.completionDeclaration && <div className="mt-2 space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-zinc-800">
                      <p><strong>Actions:</strong> {item.completionDeclaration.actionsSummary}</p>
                      <p><strong>Checks and results:</strong> {item.completionDeclaration.checksSummary}</p>
                      <p><strong>Reported outcome:</strong> {declarationOutcomeLabel(item.completionDeclaration.outcome)}</p>
                      <p><strong>Remaining work:</strong> {item.completionDeclaration.remainingWork}</p>
                      <p className="text-xs text-amber-950">Bound to {item.declarationWorkEntryIds?.length ?? 0} work entries from this assignment. This report is not sign-off.</p>
                    </div>}
                    <p className="mt-1 text-xs text-zinc-500">{item.actorName} · {dateTime(item.createdAt, timeZone)}</p>
                  </li>
                ))}
              </ol>
            ) : workEntries.isPending ? <Loading label="Loading work history" /> : workEntries.isError ? <Failure error={workEntries.error} retry={() => { void workEntries.refetch(); }} /> : workEntries.data.items.length === 0 ? (
              <p className="mt-2 text-sm text-zinc-600">No work entries have been added to this task.</p>
            ) : <>
            <ol className="mt-2 space-y-3 border-l border-zinc-300 pl-4">
              {workEntries.data.items.map(item => (
                <li key={item.id} className="relative min-w-0">
                  <span className="absolute -left-[1.35rem] top-1 size-2 rounded-full bg-emerald-700" aria-hidden="true" />
                  <p className="font-medium text-zinc-900">{workKindLabel(item.kind)} · {workResultLabel(item.result)}</p>
                  <p className="mt-1 font-medium text-zinc-800">{item.summary}</p>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm text-zinc-700">{item.detail}</p>
                  {item.observedAt && <p className="mt-1 text-xs text-zinc-600">Happened {dateTime(item.observedAt, timeZone)}</p>}
                  {item.supersedesEntryId && <p className="mt-1 text-xs text-amber-800">Correction to an earlier entry{item.correctionReason ? `: ${item.correctionReason}` : "."} The original entry remains in history.</p>}
                  <p className="mt-1 text-xs text-zinc-500">Recorded by {item.actorName} · {dateTime(item.recordedAt, timeZone)}</p>
                  <Button variant="secondary" type="button" className="mt-2" disabled={saveWorkEntry.isPending || workRetryRequired} onClick={() => beginCorrection(item)}>Correct entry</Button>
                </li>
              ))}
            </ol>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200 pt-3">
              <p className="text-xs text-zinc-600" aria-live="polite">Page {workEntries.data.pagination.page} of {Math.max(workEntries.data.pagination.totalPages, 1)} · {workEntries.data.pagination.totalItems} entries</p>
              <div className="flex gap-2">
                <Button variant="secondary" type="button" disabled={workEntries.data.pagination.page <= 1 || workEntries.isFetching} onClick={() => setWorkPage(page => Math.max(1, page - 1))}>Previous</Button>
                <Button variant="secondary" type="button" disabled={workEntries.data.pagination.page >= workEntries.data.pagination.totalPages || workEntries.isFetching} onClick={() => setWorkPage(page => page + 1)}>Next</Button>
              </div>
            </div>
            </>}
          </div>
          </div>
          <TaskChecklistOutcomes task={task} siteId={siteId} />
        </div>
      )}
    </section>
  );
}

function workKindLabel(kind: WorkEntryKind) {
  return ({ finding: "Finding", test: "Test", action: "Work done", "follow-up": "Follow-up" })[kind];
}

function taskActivityLabel(item: TaskActivityItem) {
  if (item.entryType === "acknowledgement") return "Acknowledged";
  if (item.entryType === "progress") return `Progress · ${item.progressState ?? "not stated"}`;
  if (item.entryType === "comment") return "Comment";
  if (item.requestType === "supervisor-review") return item.completionDeclaration ? "Work report sent for Supervisor review" : "Supervisor review requested";
  return `Request · ${item.requestType ?? "not stated"}`;
}

function declarationOutcomeLabel(outcome: "reported-complete" | "reported-incomplete" | "blocked") {
  return ({ "reported-complete": "Worker reports complete", "reported-incomplete": "Worker reports work remains", blocked: "Worker reports blocked" })[outcome];
}

function workResultLabel(result: WorkEntryResult) {
  return ({ observed: "observed", reproduced: "concern reproduced", "not-reproduced": "concern not reproduced", inconclusive: "inconclusive", done: "done", partial: "partly done", pending: "still needed", blocked: "blocked" })[result];
}

function formatElapsed(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}h ${String(minutes).padStart(2, "0")}m`
    : `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

function toLocalDateTime(value: string, timeZone: string) {
  return instantToSiteDateTimeInput(value, timeZone);
}

export function MyAssignedTasks() {
  const { site } = useStaff();
  const online = useOnline();
  const [page, setPage] = useState(1);
  const [searchText, setSearchText] = useState("");
  const [query, setQuery] = useState("");
  const pageSize = 25;
  const queryClient = useQueryClient();
  const labor = useQuery({
    queryKey: ["my-task-labor-session", site.id],
    queryFn: () => request(myTaskLaborSessionPath(site.id), activeTaskLaborSessionSchema),
    enabled: online,
    refetchInterval: online ? 10_000 : false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    retry: false,
  });
  const startAttempt = useRef<{ fingerprint: string; commandId: string; body: Record<string, unknown> } | null>(null);
  const stopAttempt = useRef<{ fingerprint: string; commandId: string; body: Record<string, unknown> } | null>(null);
  const startLabor = useMutation({
    mutationFn: ({ task, commandId, body }: { task: AssignedTask; commandId: string; body: Record<string, unknown> }) =>
      request(myTaskLaborStartPath(site.id, task.workOrderId, task.taskId), taskLaborSessionSchema, {
        method: "POST", commandId, body,
      }),
    onSuccess: async () => {
      startAttempt.current = null;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["my-task-labor-session", site.id] }),
        queryClient.invalidateQueries({ queryKey: ["my-assigned-tasks", site.id] }),
      ]);
    },
  });
  const stopLabor = useMutation({
    mutationFn: ({ sessionId, commandId, body }: { sessionId: string; commandId: string; body: Record<string, unknown> }) =>
      request(myTaskLaborStopPath(site.id, sessionId), taskLaborSessionSchema, {
        method: "POST", commandId, body,
      }),
    onSuccess: async () => {
      stopAttempt.current = null;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["my-task-labor-session", site.id] }),
        queryClient.invalidateQueries({ queryKey: ["my-assigned-tasks", site.id] }),
      ]);
    },
  });

  function beginTaskLabor(task: AssignedTask) {
    startLabor.reset();
    stopLabor.reset();
    const body = {
      expectedWorkPlanRevisionId: task.workPlanRevisionId,
      expectedAssignmentRevision: task.assignmentRevision,
    };
    const fingerprint = JSON.stringify([task.workOrderId, task.taskId, body]);
    if (startAttempt.current?.fingerprint !== fingerprint) {
      startAttempt.current = { fingerprint, commandId: crypto.randomUUID(), body };
    }
    startLabor.mutate({ task, commandId: startAttempt.current.commandId, body: startAttempt.current.body });
  }

  function finishTaskLabor(session: NonNullable<(typeof activeTaskLaborSessionSchema)['_output']['session']>) {
    startLabor.reset();
    stopLabor.reset();
    const body = { expectedStartedAt: session.startedAt };
    const fingerprint = JSON.stringify([session.id, body]);
    if (stopAttempt.current?.fingerprint !== fingerprint) {
      stopAttempt.current = { fingerprint, commandId: crypto.randomUUID(), body };
    }
    stopLabor.mutate({ sessionId: session.id, commandId: stopAttempt.current.commandId, body: stopAttempt.current.body });
  }

  const tasks = useQuery({
    queryKey: ["my-assigned-tasks", site.id, query, page, pageSize],
    queryFn: () => request(myAssignedTasksPath(site.id, query, page, pageSize), myAssignedTasksSchema),
    refetchInterval: 20_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
  const activeTask = labor.data?.session
    ? tasks.data?.items.find(task => task.workOrderId === labor.data!.session!.workOrderId && task.taskId === labor.data!.session!.taskId)
    : undefined;
  useEffect(() => {
    const actualPage = tasks.data?.pagination.page;
    if (actualPage !== undefined && actualPage !== page) setPage(actualPage);
  }, [page, tasks.data?.pagination.page]);

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPage(1);
    setQuery(searchText.trim());
  }

  function clearSearch() {
    setSearchText("");
    setQuery("");
    setPage(1);
  }

  const pagination = tasks.data?.pagination;
  const firstResult = pagination && pagination.totalItems > 0
    ? (pagination.page - 1) * pagination.pageSize + 1
    : 0;
  const lastResult = pagination ? Math.min(pagination.page * pagination.pageSize, pagination.totalItems) : 0;

  return (
    <>
      <PageHeading eyebrow="Workshop" title="My assigned tasks">
        Tasks currently assigned to you under the service centre work plan.
      </PageHeading>
      <div className="mb-6 flex gap-3 rounded-xl border border-amber-200 bg-amber-50/70 p-4 text-sm leading-6 text-amber-950">
        <ClipboardCheck className="mt-1 size-4 shrink-0 text-amber-800" aria-hidden="true" />
        <p>
          An assignment is for coordination only. It does not authorize you to start, diagnose, or repair.
          Confirm the current approved instructions, safety controls and your work permission with your supervisor
          before beginning. Updates here record progress and requests only; they cannot record completion or sign-off.
        </p>
      </div>

      <section className="mb-6 rounded-xl border border-zinc-200 bg-zinc-50 p-4 sm:p-5" aria-labelledby="task-labor-heading">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="task-labor-heading" className="text-base font-semibold text-zinc-950">Task time record</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-zinc-600">
              Records elapsed time only. It does not authorize work, complete a task, or set a charge.
            </p>
          </div>
          {labor.isPending && <span className="text-sm text-zinc-500" role="status">Checking for an active session…</span>}
          {!online && <span className="text-sm text-amber-900" role="status">Connect to the workshop network to start or stop time.</span>}
        </div>
        {labor.isError && (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <p className="text-sm text-red-800" role="alert">{labor.error instanceof Error ? labor.error.message : "The time record could not be loaded. Refresh before recording time."}</p>
            <Button variant="secondary" type="button" onClick={() => void labor.refetch()}>Try again</Button>
          </div>
        )}
        {labor.data?.session && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-sky-200 bg-white p-3">
            <p className="text-sm text-zinc-800" aria-live="polite">
              Time is being recorded for <span className="font-semibold">{activeTask
                ? `${activeTask.bookingReference} · ${activeTask.taskReference} ${activeTask.taskTitle}`
                : "a work-order task"}</span> since {dateTime(labor.data.session.startedAt, site.timeZone)}
              <span className="ml-2 tabular-nums text-zinc-600">({formatElapsed(labor.data.session.elapsedSeconds)})</span>.
            </p>
            <Button
              variant="secondary"
              type="button"
              disabled={!online || stopLabor.isPending || labor.isFetching}
              onClick={() => finishTaskLabor(labor.data!.session!)}
            >
              <Square className="size-4" aria-hidden="true" />
              {stopLabor.isPending ? "Saving time…" : "Stop time"}
            </Button>
          </div>
        )}
        {(startLabor.isError || stopLabor.isError) && (
          <p className="mt-3 text-sm text-red-800" role="alert">
            {(startLabor.error ?? stopLabor.error) instanceof Error ? (startLabor.error ?? stopLabor.error)!.message : "The time record could not be saved. Refresh and try again."}
          </p>
        )}
        <span className="sr-only" aria-live="polite">
          {startLabor.isSuccess ? "Task time recording started." : stopLabor.isSuccess ? "Task time recording stopped." : ""}
        </span>
      </section>

      {tasks.isPending ? (
        <Loading label="Loading your assigned tasks" />
      ) : tasks.isError ? (
        <Failure error={tasks.error} retry={() => { void tasks.refetch(); }} />
      ) : (
        <section className="panel" aria-labelledby="assigned-tasks-heading" aria-busy={tasks.isFetching}>
          <div className="panel-heading flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 id="assigned-tasks-heading" className="section-title">Current assignments</h2>
              <p className="mt-1 text-sm text-zinc-500" aria-live="polite">
                Showing {firstResult}–{lastResult} of {tasks.data.pagination.totalItems} {tasks.data.pagination.totalItems === 1 ? "task" : "tasks"}
                {query && " matching your search"}
                {tasks.data.pagination.totalPages > 1 && ` · Page ${tasks.data.pagination.page} of ${tasks.data.pagination.totalPages}`}
              </p>
            </div>
            <span className="text-xs text-zinc-500">Updates automatically</span>
          </div>

          <form className="flex flex-wrap items-end gap-3 border-b border-zinc-200 px-5 py-4 sm:px-6" role="search" onSubmit={submitSearch}>
            <div className="min-w-0 flex-1 sm:min-w-64">
              <label htmlFor="assigned-task-search">Search assigned tasks</label>
              <input
                id="assigned-task-search"
                type="search"
                autoComplete="off"
                maxLength={120}
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                placeholder="Booking, registration or task"
              />
              <p className="field-hint">Search by booking, registration, task number or task name.</p>
            </div>
            <Button variant="secondary" type="submit" disabled={tasks.isFetching}>
              <Search className="size-4" aria-hidden="true" /> Search
            </Button>
            {(searchText || query) && (
              <Button variant="secondary" type="button" onClick={clearSearch} disabled={tasks.isFetching}>
                <X className="size-4" aria-hidden="true" /> Clear
              </Button>
            )}
          </form>

          {tasks.data.items.length === 0 ? (
            <Empty title={query ? "No tasks match your search" : "No current tasks assigned"}>
              {query ? (
                <>
                  No current assignments match “{query}”. Clear the search to see all your assignments.
                  <span className="mt-4 block"><Button variant="secondary" type="button" onClick={clearSearch}>Clear search</Button></span>
                </>
              ) : (
                "When your supervisor assigns a task from a current work plan, it will appear here."
              )}
            </Empty>
          ) : (
            <>
              <ul className="divide-y divide-zinc-200" aria-label="Tasks currently assigned to you">
                {tasks.data.items.map((task) => (
                  <li key={`${task.workOrderId}:${task.taskId}`} className="relative min-w-0 p-5 sm:p-6">
                    <span className="absolute inset-y-5 left-0 w-1 rounded-r bg-sky-700" aria-hidden="true" />
                    <article className="min-w-0 pl-3">
                      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="flex flex-wrap items-center gap-2 text-sm">
                            <Badge>{task.bookingReference}</Badge>
                            <span className="font-medium text-zinc-800">{task.registration || "Registration not recorded"}</span>
                            <span className="text-zinc-500">{task.vehicleLabel}</span>
                          </p>
                          <h3 className="mt-3 break-words text-base font-semibold text-zinc-950">
                            <span className="mr-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">{task.taskReference}</span>
                            {task.taskTitle}
                          </h3>
                          <dl className="mt-3 grid min-w-0 gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
                            <div className="min-w-0"><dt className="text-xs text-zinc-500">Supervisor</dt><dd className="mt-0.5 break-words text-zinc-800">{task.supervisorName}</dd></div>
                            <div><dt className="text-xs text-zinc-500">Work plan</dt><dd className="mt-0.5 text-zinc-800">Revision {task.planRevisionNumber}</dd></div>
                            <div><dt className="text-xs text-zinc-500">Assigned</dt><dd className="mt-0.5 text-zinc-800"><time dateTime={task.assignedAt}>{dateTime(task.assignedAt, site.timeZone)}</time></dd></div>
                          </dl>
                        </div>
                        <Link className="button button-secondary min-h-11 shrink-0" to={`/sites/${site.id}/work-orders/${task.workOrderId}`}>
                          <span aria-hidden="true">View work order</span>
                          <span className="sr-only">View work order {task.bookingReference}, task {task.taskReference}</span>
                        </Link>
                      </div>
                      <div className="mt-4 flex flex-wrap items-center gap-3">
                        <Button
                          variant="secondary"
                          type="button"
                          disabled={!online || labor.isPending || labor.isError || Boolean(labor.data?.session) || startLabor.isPending || stopLabor.isPending}
                          onClick={() => beginTaskLabor(task)}
                        >
                          <Clock3 className="size-4" aria-hidden="true" />
                          {startLabor.isPending && startLabor.variables?.task.taskId === task.taskId ? "Starting…" : "Record time"}
                        </Button>
                        {labor.data?.session && (labor.data.session.workOrderId !== task.workOrderId || labor.data.session.taskId !== task.taskId) && (
                          <span className="text-sm text-zinc-600">Stop the active session above before recording time on another task.</span>
                        )}
                      </div>
                      <TaskActivity task={task} siteId={site.id} timeZone={site.timeZone} />
                    </article>
                  </li>
                ))}
              </ul>
              <nav className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200 px-5 py-4 sm:px-6" aria-label="Assigned task pages">
                <Button variant="secondary" disabled={tasks.data.pagination.page <= 1 || tasks.isFetching} onClick={() => setPage((current) => Math.max(1, current - 1))}>
                  <ChevronLeft className="size-4" aria-hidden="true" /> Previous
                </Button>
                <span className="text-sm text-zinc-500">
                  Page {tasks.data.pagination.page} of {Math.max(1, tasks.data.pagination.totalPages)}
                </span>
                <Button variant="secondary" disabled={tasks.data.pagination.page >= tasks.data.pagination.totalPages || tasks.isFetching} onClick={() => setPage((current) => current + 1)}>
                  Next <ChevronRight className="size-4" aria-hidden="true" />
                </Button>
              </nav>
            </>
          )}
        </section>
      )}
    </>
  );
}
