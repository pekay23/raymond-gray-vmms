import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, checklistItemReviewPath, checklistItemReviewResultSchema, checklistReviewQueuePath, checklistReviewQueueSchema, request, sitePath, type ChecklistReviewQueue } from './api';
import { Button, Failure, Loading, dateTime, useOnline, useToast } from './ui';
import { useStaff } from './workspace';

type ReviewItem = ChecklistReviewQueue['items'][number];

const resultLabels: Record<ReviewItem['result'], string> = {
  completed: 'Recorded as completed',
  failed: 'Failed',
  'not-checked': 'Not checked',
  'not-completed': 'Not completed',
  blocked: 'Blocked',
  'not-applicable': 'Not applicable',
};

export function ChecklistReviewQueue({ pageSize = 5 }: { pageSize?: number }) {
  const { site } = useStaff();
  const online = useOnline();
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ['checklist-review-queue', site.id, page, pageSize],
    queryFn: () => request(checklistReviewQueuePath(site.id, page, pageSize), checklistReviewQueueSchema),
    enabled: online,
    retry: false,
  });

  return (
    <article className="panel min-w-0 border-l-4 border-l-amber-600 p-5" aria-labelledby="checklist-review-queue-title">
      <div className="min-w-0">
        <h3 id="checklist-review-queue-title" className="font-semibold text-zinc-950">Checklist records to review</h3>
        <p className="mt-1 text-sm text-zinc-600">Confirm that an entry is supported or return it for correction.</p>
      </div>
      <p className="mt-3 border-l-2 border-amber-500 pl-3 text-xs leading-5 text-zinc-700">
        A record review does not complete a task, approve a repair, clear a hold, or authorize release. Failed and blocked results stay unchanged.
      </p>
      <div className="mt-4">
        {!online && !query.data ? (
          <p role="status" className="border-l-2 border-amber-600 pl-3 text-sm text-zinc-700">Reconnect to load checklist records awaiting review.</p>
        ) : query.isPending ? (
          <Loading label="Loading checklist records for review" />
        ) : query.isError ? (
          <Failure error={query.error} retry={() => void query.refetch()} />
        ) : (
          <>
            {!online && <p role="status" className="mb-3 border-l-2 border-amber-600 pl-3 text-sm text-zinc-700">Offline — showing the last loaded list. Reconnect before recording a review.</p>}
            {!query.data.canReview ? (
              <p role="status" className="border-l-2 border-amber-600 pl-3 text-sm text-zinc-700">
                A current checklist-record review grant is required. Ask the authorized technical manager to review access.
              </p>
            ) : query.data.items.length === 0 ? (
              <p className="text-sm text-zinc-600">No checklist records are waiting for review in your current work scope.</p>
            ) : (
              <ul className="divide-y divide-zinc-200">
                {query.data.items.map(item => <ReviewCard key={item.outcomeRevisionId} item={item} siteId={site.id} timeZone={site.timeZone} />)}
              </ul>
            )}
            {query.data.pagination.totalPages > 1 && (
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Button variant="secondary" disabled={page <= 1} onClick={() => setPage(value => Math.max(1, value - 1))}>Previous</Button>
                <span role="status" className="text-sm text-zinc-600">Page {query.data.pagination.page} of {query.data.pagination.totalPages} · {query.data.pagination.totalItems} records</span>
                <Button variant="secondary" disabled={page >= query.data.pagination.totalPages} onClick={() => setPage(value => value + 1)}>Next</Button>
              </div>
            )}
          </>
        )}
      </div>
    </article>
  );
}

function ReviewCard({ item, siteId, timeZone }: { item: ReviewItem; siteId: string; timeZone: string }) {
  const online = useOnline();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [validationMessage, setValidationMessage] = useState('');
  const attempt = useRef<{ fingerprint: string; commandId: string } | null>(null);
  const mutation = useMutation({
    mutationFn: async (disposition: 'record-confirmed' | 'returned-for-correction') => {
      const normalizedReason = reason.trim();
      if (!normalizedReason) throw new Error('Enter a reason before saving this review.');
      const body = {
        expectedChecklistVersion: item.checklistVersion,
        expectedWorkPlanRevisionId: item.workPlanRevisionId,
        expectedAssignmentRevision: item.assignmentRevision,
        outcomeRevisionId: item.outcomeRevisionId,
        disposition,
        reason: normalizedReason,
      };
      const fingerprint = JSON.stringify(body);
      if (!attempt.current || attempt.current.fingerprint !== fingerprint) attempt.current = { fingerprint, commandId: crypto.randomUUID() };
      return request(checklistItemReviewPath(siteId, item), checklistItemReviewResultSchema, {
        method: 'POST', commandId: attempt.current.commandId, body,
      });
    },
    onSuccess: async result => {
      attempt.current = null;
      setReason('');
      setValidationMessage('');
      toast(result.disposition === 'record-confirmed' ? 'Checklist record confirmed. Technical work status is unchanged.' : 'Checklist record returned for correction.');
      await queryClient.invalidateQueries({ queryKey: ['checklist-review-queue', siteId] });
      await queryClient.invalidateQueries({ queryKey: ['work-order-checklists', siteId, item.workOrderId] });
    },
    onError: error => {
      if (error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== 408) attempt.current = null;
      setValidationMessage(error instanceof Error ? error.message : 'The review could not be saved. Retry the same action.');
    },
  });
  const confirmationBlocked = item.hasOpenHold || (item.evidenceRequired && !item.evidenceCurrent);

  function submit(disposition: 'record-confirmed' | 'returned-for-correction') {
    if (!reason.trim()) {
      setValidationMessage('Enter a reason before saving this review.');
      return;
    }
    setValidationMessage('');
    mutation.mutate(disposition);
  }

  return (
    <li className="min-w-0 py-4 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <Link className="font-semibold text-blue-800 underline underline-offset-4" to={`${sitePath(siteId)}/work-orders/${item.workOrderId}`}>
            {item.bookingReference} · {item.taskReference} · {item.itemCode}
          </Link>
          <p className="mt-1 break-words text-sm font-medium text-zinc-900">{item.itemLabel}</p>
          <p className="mt-1 break-words text-xs text-zinc-600">{item.vehicleLabel}{item.registration ? ` · ${item.registration}` : ''} · {item.taskTitle}</p>
        </div>
        <span className="rounded-full border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-700">{resultLabels[item.result]}</span>
      </div>
      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        <div><dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Technician</dt><dd className="mt-0.5 text-zinc-800">{item.technicianName}</dd></div>
        <div><dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Recorded</dt><dd className="mt-0.5 text-zinc-800">{dateTime(item.recordedAt, timeZone)}</dd></div>
      </dl>
      {item.reason && <p className="mt-3 break-words text-sm leading-5 text-zinc-800"><span className="font-semibold">Reason:</span> {item.reason}</p>}
      {item.comments && <p className="mt-1 break-words text-sm leading-5 text-zinc-800"><span className="font-semibold">Technician note:</span> {item.comments}</p>}
      {item.measurement && <p className="mt-1 break-words text-sm leading-5 text-zinc-800"><span className="font-semibold">Measurement:</span> {Object.values(item.measurement).filter(value => typeof value === 'string').join(' · ')}</p>}
      {item.evidence.length > 0 && <p className="mt-1 break-words text-xs text-zinc-600"><span className="font-semibold">Accepted evidence:</span> {item.evidence.map(file => file.displayName).join(', ')}</p>}
      {item.hasOpenHold && <p role="status" className="mt-3 border-l-4 border-amber-600 bg-amber-50 px-3 py-2 text-sm leading-5 text-amber-950">A safety hold is open. You may return this record for correction; confirming is blocked until the hold is resolved.</p>}
      {item.evidenceRequired && !item.evidenceCurrent && <p role="status" className="mt-3 border-l-4 border-amber-600 bg-amber-50 px-3 py-2 text-sm leading-5 text-amber-950">Current accepted evidence is required before this record can be confirmed.</p>}
      <label className="mt-3 block text-sm font-medium text-zinc-800" htmlFor={`checklist-review-reason-${item.outcomeRevisionId}`}>
        Review reason
        <textarea id={`checklist-review-reason-${item.outcomeRevisionId}`} value={reason} maxLength={1200} onChange={event => setReason(event.target.value)} className="mt-1 block min-h-20 w-full rounded-lg border border-zinc-300 bg-white p-2 text-sm" aria-describedby={`checklist-review-help-${item.outcomeRevisionId}`} />
      </label>
      <p id={`checklist-review-help-${item.outcomeRevisionId}`} className="mt-1 text-xs leading-5 text-zinc-600">Explain why the entry is supported or what needs correction. Confirming this record does not mean the work passed.</p>
      {validationMessage && <p role="alert" className="mt-2 text-sm text-red-800">{validationMessage}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" disabled={!online || mutation.isPending || confirmationBlocked} onClick={() => submit('record-confirmed')}>Confirm record</Button>
        <Button type="button" variant="secondary" disabled={!online || mutation.isPending} onClick={() => submit('returned-for-correction')}>Return for correction</Button>
      </div>
    </li>
  );
}
