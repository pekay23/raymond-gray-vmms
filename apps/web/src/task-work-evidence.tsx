import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  evidenceIntentContentPath,
  evidenceIntentPath,
  evidenceIntentSchema,
  evidenceIntentStatusSchema,
  evidenceRecordPath,
  evidenceRecordSchema,
  myTaskEvidenceIntentPath,
  request,
  uploadEvidenceFile,
} from "./api";
import { loadTaskEvidenceDraft, removeTaskEvidenceDraft, saveTaskEvidenceDraft } from "./drafts";
import type { TaskEvidenceDraft } from "./drafts";
import { useStaff } from "./workspace";
import { Button, useOnline } from "./ui";

type Task = {
  workOrderId: string;
  taskId: string;
  workPlanRevisionId: string;
  assignmentRevision: number;
};

const mediaTypeByExtension: Readonly<Record<string, string>> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
};

function declaredType(file: File) {
  if (file.type.trim()) return file.type.trim().toLowerCase();
  const extension = file.name.split(".").at(-1)?.toLowerCase() ?? "";
  return mediaTypeByExtension[extension] ?? "application/octet-stream";
}

export function TaskWorkEvidence({
  task,
  siteId,
  disabled,
  linkedEvidenceIds,
}: {
  task: Task;
  siteId: string;
  disabled: boolean;
  linkedEvidenceIds: readonly string[];
}) {
  const { session } = useStaff();
  const online = useOnline();
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [keepRecovery, setKeepRecovery] = useState(false);
  const [draft, setDraft] = useState<TaskEvidenceDraft | null>(null);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<{ sent: number; total: number } | null>(null);
  const [uploadedEvidenceId, setUploadedEvidenceId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const loaded = loadTaskEvidenceDraft(session.user.id, siteId, task.workOrderId, task.taskId,
      task.workPlanRevisionId, task.assignmentRevision);
    setDraft(loaded.draft);
    setRecoveryError(loaded.error);
    setKeepRecovery(Boolean(loaded.draft));
    setUploadedEvidenceId(null);
    setSelectedFile(null);
  }, [session.user.id, siteId, task.assignmentRevision, task.taskId, task.workOrderId, task.workPlanRevisionId]);

  const recoveredIntent = useQuery({
    queryKey: ["task-evidence-intent", siteId, task.workOrderId, task.taskId, draft?.intentId],
    queryFn: () => request(evidenceIntentPath(siteId, draft?.intentId ?? ""), evidenceIntentStatusSchema),
    enabled: Boolean(draft?.intentId && online),
    retry: false,
  });
  useEffect(() => {
    if (recoveredIntent.data?.state === "completed") {
      setUploadedEvidenceId(recoveredIntent.data.evidenceId);
      setMessage("The upload reached the server. Check its security status before adding it to a work entry.");
    }
  }, [recoveredIntent.data]);

  const evidenceId = uploadedEvidenceId;
  const evidence = useQuery({
    queryKey: ["task-evidence-status", siteId, task.workOrderId, task.taskId, evidenceId],
    queryFn: () => request(evidenceRecordPath(siteId, evidenceId ?? ""), evidenceRecordSchema),
    enabled: Boolean(evidenceId && online),
    retry: false,
    refetchInterval: query => query.state.data?.state === "pending" || query.state.data?.state === "quarantined" ? 1500 : false,
  });
  useEffect(() => {
    if (evidence.data?.state !== "accepted") return;
    setMessage("Security check passed. Select the file below when recording the work it supports.");
    void queryClient.invalidateQueries({ queryKey: ["my-task-work-evidence", siteId, task.workOrderId, task.taskId] });
  }, [evidence.data?.state, queryClient, siteId, task.taskId, task.workOrderId]);

  useEffect(() => {
    if (!draft?.intentId || recoveredIntent.data?.state !== "completed") return;
    if (!linkedEvidenceIds.includes(recoveredIntent.data.evidenceId)) return;
    removeTaskEvidenceDraft(session.user.id, siteId, task.workOrderId, task.taskId);
    setDraft(null);
    setKeepRecovery(false);
    setUploadedEvidenceId(null);
    setSelectedFile(null);
    if (fileInput.current) fileInput.current.value = "";
  }, [draft?.intentId, linkedEvidenceIds, recoveredIntent.data, session.user.id, siteId, task.taskId, task.workOrderId]);

  const upload = useMutation({
    mutationFn: async (file: File) => {
      setMessage(null);
      const type = declaredType(file);
      let current = draft;
      if (current && (current.displayName !== file.name || current.expectedBytes !== file.size || current.declaredMediaType !== type)) {
        throw new ApiError("Choose the same file name, type and size to resume this upload, or clear the saved details first.", 409, "TASK_EVIDENCE_FILE_MISMATCH");
      }
      if (!current) {
        current = {
          intentId: null,
          intentCommandId: crypto.randomUUID(),
          displayName: file.name,
          declaredMediaType: type,
          expectedBytes: file.size,
          savedAt: new Date().toISOString(),
          workPlanRevisionId: task.workPlanRevisionId,
          assignmentRevision: task.assignmentRevision,
        };
        setDraft(current);
      }

      if (current.intentId) {
        const existing = await request(evidenceIntentPath(siteId, current.intentId), evidenceIntentStatusSchema);
        if (existing.state === "completed") return existing.evidenceId;
        if (existing.state === "expired") {
          removeTaskEvidenceDraft(session.user.id, siteId, task.workOrderId, task.taskId);
          setDraft(null);
          throw new ApiError("This upload request expired. Choose the file again to start a new task upload.", 410, "EVIDENCE_INTENT_EXPIRED");
        }
      }

      if (!current.intentId) {
        if (keepRecovery) {
          try {
            saveTaskEvidenceDraft(session.user.id, siteId, task.workOrderId, task.taskId, current);
            setRecoveryError(null);
          } catch {
            setRecoveryError("Tab storage is unavailable. The upload can continue, but reload recovery will not be available.");
          }
        }
        const intent = await request(myTaskEvidenceIntentPath(siteId, task.workOrderId, task.taskId), evidenceIntentSchema, {
          method: "POST",
          commandId: current.intentCommandId,
          body: {
            expectedWorkPlanRevisionId: task.workPlanRevisionId,
            expectedAssignmentRevision: task.assignmentRevision,
            displayName: current.displayName,
            declaredMediaType: current.declaredMediaType,
            expectedBytes: current.expectedBytes,
          },
        });
        current = { ...current, intentId: intent.id };
        setDraft(current);
        if (keepRecovery) {
          try { saveTaskEvidenceDraft(session.user.id, siteId, task.workOrderId, task.taskId, current); }
          catch { setRecoveryError("Tab storage is unavailable. The upload can continue, but reload recovery will not be available."); }
        }
        if (intent.state === "completed") {
          const status = await request(evidenceIntentPath(siteId, intent.id), evidenceIntentStatusSchema);
          if (status.state === "completed") return status.evidenceId;
        }
      }

      const intentId = current.intentId;
      if (!intentId) throw new ApiError("The task upload request could not be recovered. Start a new upload.", 502, "EVIDENCE_INTENT_UNAVAILABLE");
      setUploadProgress({ sent: 0, total: file.size });
      try {
        const result = await uploadEvidenceFile(evidenceIntentContentPath(siteId, intentId), file,
          (sent, total) => setUploadProgress({ sent, total }));
        return result.evidenceId;
      } catch (error) {
        const status = await request(evidenceIntentPath(siteId, intentId), evidenceIntentStatusSchema).catch(() => null);
        if (status?.state === "completed") return status.evidenceId;
        throw error;
      }
    },
    onSuccess: async id => {
      setUploadedEvidenceId(id);
      setUploadProgress(null);
      setMessage("File uploaded. Its security check is in progress.");
      await queryClient.invalidateQueries({ queryKey: ["task-evidence-status", siteId, task.workOrderId, task.taskId, id] });
    },
    onError: error => {
      setUploadProgress(null);
      setMessage(error instanceof Error ? error.message : "The file could not be uploaded safely.");
    },
  });

  function clearRecovery() {
    removeTaskEvidenceDraft(session.user.id, siteId, task.workOrderId, task.taskId);
    setDraft(null);
    setUploadedEvidenceId(null);
    setSelectedFile(null);
    setKeepRecovery(false);
    setMessage("Saved upload details cleared. Choose a file to start a new upload.");
    if (fileInput.current) fileInput.current.value = "";
  }

  return (
    <section className="grid min-w-0 gap-3 rounded-md border border-sky-200 bg-sky-50/50 p-3" aria-labelledby={`task-evidence-heading-${task.taskId}`}>
      <div>
        <h4 id={`task-evidence-heading-${task.taskId}`} className="text-sm font-semibold text-zinc-900">Add a file to this task</h4>
        <p className="mt-1 text-sm leading-5 text-zinc-700">Upload a photo or document. It becomes part of the task record only when you select it and save a work entry.</p>
      </div>
      <div>
        <label htmlFor={`task-evidence-file-${task.taskId}`}>Choose a file</label>
        <input
          ref={fileInput}
          id={`task-evidence-file-${task.taskId}`}
          type="file"
          accept="application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif"
          disabled={disabled || upload.isPending || !online}
          onChange={event => { setSelectedFile(event.currentTarget.files?.[0] ?? null); setMessage(null); }}
        />
        <p className="field-hint">Use a clear photo or document related to this task. The server checks file type and scans it before use.</p>
      </div>
      <label className="flex items-start gap-2 text-sm text-zinc-700">
        <input type="checkbox" checked={keepRecovery} disabled={disabled || upload.isPending}
          onChange={event => {
            const enabled = event.target.checked;
            setKeepRecovery(enabled);
            if (!enabled) removeTaskEvidenceDraft(session.user.id, siteId, task.workOrderId, task.taskId);
            else if (draft) {
              try { saveTaskEvidenceDraft(session.user.id, siteId, task.workOrderId, task.taskId, draft); setRecoveryError(null); }
              catch { setRecoveryError("Tab storage is unavailable. The upload can continue, but reload recovery will not be available."); }
            }
          }} />
        <span>Keep upload recovery details in this tab</span>
      </label>
      {recoveryError && <p className="text-xs text-amber-900" role="status">{recoveryError}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" disabled={disabled || !online || !selectedFile || upload.isPending}
          onClick={() => { if (selectedFile) upload.mutate(selectedFile); }}>
          {upload.isPending ? "Uploading…" : draft?.intentId ? "Resume upload" : "Upload file"}
        </Button>
        {draft && <Button variant="secondary" type="button" disabled={upload.isPending} onClick={clearRecovery}>Clear saved details</Button>}
      </div>
      {uploadProgress && <div>
        <progress className="w-full" value={uploadProgress.sent} max={uploadProgress.total} aria-label="Task evidence upload progress" />
        <p className="text-xs text-zinc-600">Uploading {Math.min(uploadProgress.sent, uploadProgress.total)} of {uploadProgress.total} bytes</p>
      </div>}
      {evidence.data && evidence.data.state !== "accepted" && <p className="text-sm text-amber-900" role="status">
        {evidence.data.state === "pending" ? "Security check in progress." : evidence.data.state === "quarantined" ? "Security check is delayed. The file cannot be used yet." : "The file did not pass the security check and cannot be attached."}
      </p>}
      {evidence.data?.state === "accepted" && <p className="text-sm text-emerald-900" role="status">Security check passed. Select “{evidence.data.displayName}” below when saving the work entry.</p>}
      {evidence.isError && <p className="text-sm text-red-800" role="alert">The security status could not be checked. Retry before using the file.</p>}
      {message && !evidence.data && <p className="text-sm text-zinc-700" role="status">{message}</p>}
    </section>
  );
}
