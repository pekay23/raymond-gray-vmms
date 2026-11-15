import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Paperclip, RefreshCw, UploadCloud, X } from "lucide-react";
import {
  ApiError,
  detailSchema,
  evidenceDownloadPath,
  evidenceIntentPath,
  evidenceIntentContentPath,
  evidenceIntentSchema,
  evidenceIntentStatusSchema,
  orderPath,
  request,
  uploadEvidenceFile,
} from "./api";
import type { EvidenceIntentStatus, WorkOrder } from "./api";
import { loadEvidenceDraft, removeEvidenceDraft, saveEvidenceDraft } from "./drafts";
import type { EvidenceDraft } from "./drafts";
import { useStaff } from "./workspace";
import { Badge, Button, Empty, FormError, dateTime, useOnline } from "./ui";

type Props = {
  order: WorkOrder;
  refresh: () => void;
};

type UploadProgress = { sent: number; total: number };

const mediaTypeByExtension: Readonly<Record<string, string>> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
};

const scanLabels = {
  pending: "Security check in progress",
  quarantined: "Security check delayed",
  accepted: "Security check passed",
  rejected: "Not accepted",
} satisfies Record<WorkOrder["evidence"][number]["state"], string>;

function bytes(value: number) {
  if (value < 1024) return `${value} bytes`;
  const units = ["KB", "MB", "GB"];
  let size = value / 1024;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${new Intl.NumberFormat("en-GH", { maximumFractionDigits: 1 }).format(size)} ${units[index]}`;
}

function declaredType(file: File) {
  if (file.type.trim()) return file.type.trim().toLowerCase();
  const extension = file.name.split(".").at(-1)?.toLowerCase() ?? "";
  return mediaTypeByExtension[extension] ?? "application/octet-stream";
}

function statusTone(state: WorkOrder["evidence"][number]["state"]) {
  if (state === "accepted") return "green" as const;
  if (state === "rejected") return "danger" as const;
  if (state === "quarantined") return "warning" as const;
  return "neutral" as const;
}

export function WorkOrderEvidence({ order, refresh }: Props) {
  const { session, site } = useStaff();
  const online = useOnline();
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const recoveryStatus = useRef<HTMLParagraphElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [keepRecovery, setKeepRecovery] = useState(false);
  const [draft, setDraft] = useState<EvidenceDraft | null>(null);
  const [recoveryNotice, setRecoveryNotice] = useState<string | null>(null);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [uploadError, setUploadError] = useState<unknown>(null);
  const [attachError, setAttachError] = useState<unknown>(null);
  const [attachAttempt, setAttachAttempt] = useState<{ id: string; body: { evidenceId: string; expectedVersion: number } } | null>(null);

  useEffect(() => {
    const loaded = loadEvidenceDraft(session.user.id, site.id, order.id);
    setDraft(loaded.draft);
    setRecoveryError(loaded.error);
    setKeepRecovery(Boolean(loaded.draft));
  }, [order.id, session.user.id, site.id]);

  const recoveredIntent = useQuery({
    queryKey: ["evidence-intent", site.id, draft?.intentId],
    queryFn: () =>
      request(
        evidenceIntentPath(site.id, draft?.intentId ?? ""),
        evidenceIntentStatusSchema,
      ),
    enabled: Boolean(draft?.intentId && online),
    retry: false,
  });

  useEffect(() => {
    const stored = draft;
    const status = recoveredIntent.data;
    if (!stored || status?.state !== "completed") return;
    const attached = order.evidence.some(
      (item) => item.evidenceId === status.evidenceId && item.attachedAt,
    );
    if (attached) {
      removeEvidenceDraft(session.user.id, site.id, order.id);
      setDraft(null);
      setKeepRecovery(false);
      return;
    }
    setRecoveryNotice("The upload reached the server. Its security status is shown below.");
    removeEvidenceDraft(session.user.id, site.id, order.id);
    setDraft(null);
    setKeepRecovery(false);
    refresh();
  }, [draft, order.evidence, order.id, recoveredIntent.data, refresh, session.user.id, site.id]);

  const upload = useMutation({
    mutationFn: async (file: File) => {
      setUploadError(null);
      const type = declaredType(file);
      let currentDraft = draft;
      if (currentDraft) {
        if (
          file.name !== currentDraft.displayName ||
          file.size !== currentDraft.expectedBytes ||
          type !== currentDraft.declaredMediaType
        ) {
          throw new ApiError("Choose the same file name, type and size to resume this upload. Clear the saved recovery details to start a different upload.", 409, "EVIDENCE_FILE_MISMATCH");
        }
        if (currentDraft.intentId) {
          const status: EvidenceIntentStatus = await request(
            evidenceIntentPath(site.id, currentDraft.intentId),
            evidenceIntentStatusSchema,
          );
          if (status.state === "completed") {
            void queryClient.invalidateQueries({ queryKey: ["work-order", site.id, order.id] });
            throw new ApiError("This upload already reached the server. Review its security status below.", 409, "EVIDENCE_UPLOAD_ALREADY_COMPLETED");
          }
          if (status.state === "expired") {
            removeEvidenceDraft(session.user.id, site.id, order.id);
            setDraft(null);
            setKeepRecovery(false);
            throw new ApiError("This upload request expired. Choose the file again to start a new upload.", 410, "EVIDENCE_INTENT_EXPIRED");
          }
        }
      } else {
        currentDraft = {
          intentId: null,
          intentCommandId: crypto.randomUUID(),
          displayName: file.name,
          declaredMediaType: type,
          expectedBytes: file.size,
          savedAt: new Date().toISOString(),
        };
        setDraft(currentDraft);
      }

      if (!currentDraft.intentId) {
        if (keepRecovery) {
          try {
            saveEvidenceDraft(session.user.id, site.id, order.id, currentDraft);
            setRecoveryError(null);
          } catch {
            setRecoveryError("Tab storage is unavailable. The upload can continue, but an interrupted transfer will need a new request.");
          }
        }
        const intent = await request(
          `${orderPath(site.id, order.id)}/evidence/intents`,
          evidenceIntentSchema,
          {
            method: "POST",
            commandId: currentDraft.intentCommandId,
            body: {
              displayName: currentDraft.displayName,
              declaredMediaType: currentDraft.declaredMediaType,
              expectedBytes: currentDraft.expectedBytes,
            },
          },
        );
        if (intent.state === "completed") {
          const status: EvidenceIntentStatus = await request(
            evidenceIntentPath(site.id, intent.id),
            evidenceIntentStatusSchema,
          );
          if (status.state === "completed") {
            void queryClient.invalidateQueries({ queryKey: ["work-order", site.id, order.id] });
            throw new ApiError("This upload already reached the server. Review its security status below.", 409, "EVIDENCE_UPLOAD_ALREADY_COMPLETED");
          }
        }
        currentDraft = { ...currentDraft, intentId: intent.id };
        setDraft(currentDraft);
        if (keepRecovery) {
          try {
            saveEvidenceDraft(session.user.id, site.id, order.id, currentDraft);
            setRecoveryError(null);
          } catch {
            setRecoveryError("Tab storage is unavailable. The upload can continue, but an interrupted transfer will need a new request.");
          }
        }
      }

      const intentId = currentDraft.intentId;
      if (!intentId) throw new ApiError("The upload request could not be recovered. Start a new upload.", 502, "EVIDENCE_INTENT_UNAVAILABLE");
      setUploadProgress({ sent: 0, total: file.size });
      const result = await uploadEvidenceFile(
        evidenceIntentContentPath(site.id, intentId),
        file,
        (sent, total) => setUploadProgress({ sent, total }),
      );
      return result;
    },
    onSuccess: () => {
      removeEvidenceDraft(session.user.id, site.id, order.id);
      setDraft(null);
      setKeepRecovery(false);
      setSelectedFile(null);
      if (fileInput.current) fileInput.current.value = "";
      setUploadProgress(null);
      setRecoveryNotice("The upload is private and waiting for its security check.");
      window.requestAnimationFrame(() => recoveryStatus.current?.focus());
      void queryClient.invalidateQueries({ queryKey: ["work-order", site.id, order.id] });
    },
    onError: (error) => {
      setUploadError(error);
      setUploadProgress(null);
      if (draft && !draft.intentId && error instanceof ApiError && error.status > 0 && error.code !== "EVIDENCE_UPLOAD_ALREADY_COMPLETED") {
        removeEvidenceDraft(session.user.id, site.id, order.id);
        setDraft(null);
        setKeepRecovery(false);
      }
      if (error instanceof ApiError && error.code === "EVIDENCE_UPLOAD_ALREADY_COMPLETED") {
        setDraft(null);
        setKeepRecovery(false);
        removeEvidenceDraft(session.user.id, site.id, order.id);
        refresh();
      }
    },
  });

  const attach = useMutation({
    mutationFn: (evidenceId: string) => {
      const body = { evidenceId, expectedVersion: order.version };
      const content = JSON.stringify(body);
      if (!attachAttempt || JSON.stringify(attachAttempt.body) !== content) {
        const next = { id: crypto.randomUUID(), body };
        setAttachAttempt(next);
        setAttachError(null);
        return request(`${orderPath(site.id, order.id)}/evidence`, detailSchema, {
          method: "POST",
          commandId: next.id,
          body,
        });
      }
      return request(`${orderPath(site.id, order.id)}/evidence`, detailSchema, {
        method: "POST",
        commandId: attachAttempt.id,
        body: attachAttempt.body,
      });
    },
    onSuccess: (updated, evidenceId) => {
      setAttachAttempt(null);
      setAttachError(null);
      setRecoveryNotice("Evidence attached to the work order.");
      window.requestAnimationFrame(() => recoveryStatus.current?.focus());
      queryClient.setQueryData(["work-order", site.id, order.id], updated);
      void queryClient.invalidateQueries({ queryKey: ["work-orders", site.id] });
      if (draft && order.evidence.some((item) => item.evidenceId === evidenceId)) {
        removeEvidenceDraft(session.user.id, site.id, order.id);
        setDraft(null);
        setKeepRecovery(false);
      }
    },
    onError: (error) => {
      setAttachError(error);
      if (error instanceof ApiError && error.status === 409) setAttachAttempt(null);
      void queryClient.invalidateQueries({ queryKey: ["work-order", site.id, order.id] });
    },
  });

  function handleSaveRecovery(value: boolean) {
    setKeepRecovery(value);
    setRecoveryError(null);
    if (value && draft) {
      try {
        saveEvidenceDraft(session.user.id, site.id, order.id, draft);
      } catch {
        setRecoveryError("Tab storage is unavailable. The upload can continue, but an interrupted transfer will need a new request.");
      }
    }
    if (!value) {
      removeEvidenceDraft(session.user.id, site.id, order.id);
      setDraft(null);
      setRecoveryNotice("Saved upload details were removed from this tab. Any completed upload remains on the work order.");
    }
  }

  const resumeAvailable = draft !== null && (draft.intentId === null || recoveredIntent.data?.state === "issued");
  const pendingScan = order.evidence.some((item) => item.state === "pending" || item.state === "quarantined");
  const uploadPercent = uploadProgress && uploadProgress.total > 0
    ? Math.round((uploadProgress.sent / uploadProgress.total) * 100)
    : 0;

  return (
    <section className="panel" aria-labelledby="evidence-title" aria-busy={upload.isPending || attach.isPending || recoveredIntent.isFetching}>
      <div className="panel-heading">
        <div className="flex min-w-0 items-center gap-3">
          <Paperclip className="size-4 shrink-0 text-zinc-500" aria-hidden="true" />
          <h2 id="evidence-title" className="section-title">Evidence</h2>
          <Badge>{order.evidence.filter((item) => item.attachedAt !== null).length}</Badge>
        </div>
        {pendingScan && (
          <span className="text-xs text-zinc-500" role="status">Security check running</span>
        )}
      </div>

      {order.evidence.length === 0 ? (
        <Empty title="No evidence attached">
          Add a photo or PDF to keep it with this visit. Files remain private while they are checked.
        </Empty>
      ) : (
        <ul className="divide-y divide-zinc-100">
          {order.evidence.map((item) => {
            const attached = item.attachedAt !== null;
            return (
              <li key={item.evidenceId} className="flex min-w-0 flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                <div className="min-w-0">
                  <p className="break-words text-sm font-medium text-zinc-900">{item.displayName}</p>
                  <p className="mt-1 text-xs text-zinc-500">
                    {bytes(item.sizeBytes)} · Added {dateTime(item.uploadedAt, site.timeZone)}
                    {attached && item.attachedBy ? ` · Attached by ${item.attachedBy}` : " · Added by you, not yet attached"}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2" aria-live="polite" aria-atomic="true">
                    <Badge tone={statusTone(item.state)}>{scanLabels[item.state]}</Badge>
                    {attached && <Badge>On work order</Badge>}
                  </div>
                  {item.state === "pending" && (
                    <p className="mt-2 text-xs leading-5 text-zinc-600">This file cannot be attached or downloaded until the security check is complete.</p>
                  )}
                  {item.state === "quarantined" && (
                    <p className="mt-2 text-xs leading-5 text-zinc-600">The security check could not finish. This file stays private and unavailable. Refresh later or contact the site administrator if it remains delayed.</p>
                  )}
                  {item.state === "rejected" && (
                    <p className="mt-2 text-xs leading-5 text-zinc-600">The security check did not approve this file. It stays unavailable and cannot be attached. Choose another file or contact the site administrator.</p>
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  {!attached && item.state === "accepted" && site.canWrite && (
                    <Button variant="secondary" disabled={!online || attach.isPending} onClick={() => attach.mutate(item.evidenceId)} aria-label={`Attach ${item.displayName} to work order`}>
                      {attach.isPending ? "Attaching…" : "Attach to work order"}
                    </Button>
                  )}
                  {attached && item.state === "accepted" && (
                    <a className="button button-secondary" href={evidenceDownloadPath(site.id, item.evidenceId)} aria-label={`Download ${item.displayName}`}>
                      <Download className="size-4" aria-hidden="true" />
                      Download
                    </a>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {site.canWrite && (
        <div className="space-y-4 border-t border-zinc-200 bg-zinc-50 p-5 sm:p-6">
          <div>
            <h3 className="text-sm font-semibold text-zinc-900">Add a photo or PDF</h3>
            <p id="evidence-help" className="mt-1 text-xs leading-5 text-zinc-600">The server checks file type, size and safety. The file itself is never saved in this browser.</p>
          </div>
          <div className="space-y-3">
            <label htmlFor="work-order-evidence-file" className="block text-sm font-medium text-zinc-800">Choose a file</label>
            <input
              id="work-order-evidence-file"
              ref={fileInput}
              type="file"
              accept="image/*,application/pdf"
              aria-describedby={`evidence-help evidence-file-name${uploadError ? " evidence-upload-error" : ""}`}
              aria-invalid={uploadError ? true : undefined}
              disabled={!online || upload.isPending}
              onChange={(event) => {
                setSelectedFile(event.currentTarget.files?.item(0) ?? null);
                setUploadError(null);
                setUploadProgress(null);
              }}
              className="block min-h-11 w-full min-w-0 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-700 file:mr-3 file:min-h-8 file:rounded-md file:border-0 file:bg-zinc-100 file:px-3 file:font-medium file:text-zinc-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 disabled:cursor-not-allowed disabled:opacity-60"
            />
            <p id="evidence-file-name" className="min-h-5 break-words text-xs text-zinc-600">
              {selectedFile ? `${selectedFile.name} · ${bytes(selectedFile.size)} · ${declaredType(selectedFile)}` : "No file selected"}
            </p>
          </div>

          <label htmlFor="evidence-recovery" className="flex items-start gap-3 text-sm leading-5 text-zinc-700">
            <input
              id="evidence-recovery"
              type="checkbox"
              checked={keepRecovery}
              disabled={upload.isPending}
              onChange={(event) => handleSaveRecovery(event.currentTarget.checked)}
              className="mt-0.5 size-4 shrink-0 accent-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900"
            />
            <span>Keep this upload’s recovery details in this tab for up to eight hours if the transfer is interrupted. The file is never stored in the browser.</span>
          </label>

          {resumeAvailable && (
            <div className="rounded-lg border border-zinc-300 bg-white p-4">
              <p className="text-sm font-medium text-zinc-900">An upload was interrupted</p>
              <p className="mt-1 break-words text-xs leading-5 text-zinc-600">Choose the same file name, type and size to resume: {draft.displayName} · {bytes(draft.expectedBytes)}.</p>
              {recoveredIntent.data && <p className="mt-1 text-xs text-zinc-500">Request expires {dateTime(recoveredIntent.data.expiresAt, site.timeZone)}.</p>}
            </div>
          )}

          {uploadProgress && upload.isPending && (
            <div className="space-y-2" aria-busy="true">
              <div className="flex items-center justify-between gap-3 text-xs text-zinc-600">
                <span>Uploading securely</span>
                <span aria-hidden="true">{uploadPercent}%</span>
              </div>
              <progress className="h-2 w-full accent-zinc-900" max={Math.max(uploadProgress.total, 1)} value={Math.min(uploadProgress.sent, Math.max(uploadProgress.total, 1))} aria-label="Evidence upload progress" aria-valuetext={`${uploadPercent}% uploaded`} />
            </div>
          )}

          {!online && <p className="text-sm text-amber-800">Reconnect to upload or attach evidence. This file has not been queued for offline transfer.</p>}
          {recoveryNotice && <p ref={recoveryStatus} tabIndex={-1} role="status" className="text-sm text-zinc-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900">{recoveryNotice}</p>}
          {recoveryError && <p role="alert" className="text-sm text-amber-800">{recoveryError}</p>}
          {recoveredIntent.isError && (
            <div className="flex flex-wrap items-center gap-3">
              <p role="alert" className="text-sm text-amber-800">The saved upload request could not be checked. Refresh the work order before starting another upload.</p>
              <Button variant="secondary" onClick={() => void recoveredIntent.refetch()} aria-label="Retry upload recovery check">
                <RefreshCw className="size-4" aria-hidden="true" />
                Check again
              </Button>
            </div>
          )}
          <div id="evidence-upload-error"><FormError error={uploadError} /></div>
          <FormError error={attachError} />
          <div className="flex flex-wrap items-center gap-3">
            {selectedFile && (
              <Button
                disabled={!online || upload.isPending || (draft !== null && !resumeAvailable)}
                onClick={() => upload.mutate(selectedFile)}
              >
                <UploadCloud className="size-4" aria-hidden="true" />
                {upload.isPending ? "Uploading…" : resumeAvailable ? "Resume upload" : "Upload evidence"}
              </Button>
            )}
            {draft && !upload.isPending && (
              <Button
                variant="secondary"
                onClick={() => {
                  removeEvidenceDraft(session.user.id, site.id, order.id);
                  setDraft(null);
                  setKeepRecovery(false);
                  setRecoveryNotice("Saved recovery details removed. An already uploaded file remains listed above.");
                  window.requestAnimationFrame(() => fileInput.current?.focus());
                }}
              >
                <X className="size-4" aria-hidden="true" />
                Clear recovery details
              </Button>
            )}
          </div>
          {draft && recoveredIntent.data?.state === "expired" && (
            <p role="status" className="text-sm text-zinc-600">The saved request expired. Clear its recovery details, then choose the file again.</p>
          )}
        </div>
      )}
    </section>
  );
}
