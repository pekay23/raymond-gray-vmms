import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { ApiError, request, sitePath, vehicleLearningReviewQueueSchema, vehicleLearningReviewResultSchema, type VehicleLearningReviewQueue } from './api';
import { Button, Empty, Failure, Loading, useOnline, useToast } from './ui';
import { VehicleLearningActivity } from './vehicle-learning-activity';

export function VehicleLearningReviewQueue({ siteId, timeZone }: { siteId: string; timeZone: string }) {
  const online = useOnline();
  const queue = useQuery({
    queryKey: ['vehicle-learning-review-queue', siteId],
    queryFn: () => request(`${sitePath(siteId)}/vehicle-learning/review-queue`, vehicleLearningReviewQueueSchema),
    enabled: online,
    retry: false,
  });

  if (queue.isError && queue.error instanceof ApiError && queue.error.status === 403) return null;
  if (!online && !queue.data) return null;

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm" aria-labelledby="learning-review-heading">
      <h2 id="learning-review-heading" className="text-xl font-semibold">Learning notes to review</h2>
      <p className="mt-2 text-sm text-zinc-600">Review the learner’s evidence and reasoning. This records learning feedback; it does not verify vehicle facts or authorize work.</p>
      {queue.isLoading && <Loading label="Loading learning notes to review" />}
      {queue.isError && <Failure error={queue.error} retry={() => void queue.refetch()} />}
      {queue.data && queue.data.items.length === 0 && <Empty title="No learning notes to review">Submitted notes with no review decision will appear here.</Empty>}
      {queue.data && queue.data.items.length > 0 && (
        <ul className="mt-3 divide-y divide-zinc-200">
          {queue.data.items.map(item => <ReviewItem key={item.id} item={item} siteId={siteId} timeZone={timeZone} />)}
        </ul>
      )}
    </section>
  );
}

function ReviewItem({ item, siteId, timeZone }: { item: VehicleLearningReviewQueue['items'][number]; siteId: string; timeZone: string }) {
  const online = useOnline();
  const queryClient = useQueryClient();
  const toast = useToast();
  const attempt = useRef<{ key: string; payload: string } | null>(null);
  const [reason, setReason] = useState('');
  const [shareWithAfterSales, setShareWithAfterSales] = useState(false);
  const mutation = useMutation({
    mutationFn: ({ decision, share }: { decision: 'changes-requested' | 'reviewed-learning-record'; share?: boolean }) => {
      const body = { expectedVersion: item.version, decision, reason, shareWithAfterSales: decision === 'reviewed-learning-record' && Boolean(share) };
      const payload = JSON.stringify(body);
      if (!attempt.current || attempt.current.payload !== payload) attempt.current = { key: crypto.randomUUID(), payload };
      return request(`${sitePath(siteId)}/vehicle-learning/${encodeURIComponent(item.id)}/reviews`, vehicleLearningReviewResultSchema, {
        method: 'POST', commandId: attempt.current.key, body,
      });
    },
    onSuccess: async result => {
      attempt.current = null;
      setReason('');
      setShareWithAfterSales(false);
      toast(result.decision === 'changes-requested' ? 'Changes requested from the learner.' : result.shareWithAfterSales
        ? 'Learning note marked as reviewed and shared with after-sales staff.'
        : 'Learning note marked as reviewed.');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['vehicle-learning-review-queue', siteId] }),
        queryClient.invalidateQueries({ queryKey: ['vehicle-learning-activity', siteId, item.id] }),
        queryClient.invalidateQueries({ queryKey: ['vehicle-learning-library', siteId] }),
      ]);
    },
    onError: async problem => {
      if (problem instanceof ApiError && problem.status === 409) attempt.current = null;
      await queryClient.invalidateQueries({ queryKey: ['vehicle-learning-review-queue', siteId] });
    },
  });

  return (
    <li className="py-4">
      <details>
        <summary className="cursor-pointer rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
          <span className="font-medium">{item.title} · {item.makeModel}</span>
          <span className="mt-1 block text-sm text-zinc-600">From {item.authorName} · {item.powertrain} · {item.drivetrain} · version {item.version}</span>
        </summary>
        <div className="mt-4 space-y-4">
          <VehicleLearningActivity entryId={item.id} siteId={siteId} timeZone={timeZone} accessScope="reviewer" />
          <form className="space-y-3 rounded-lg border border-zinc-200 bg-zinc-50 p-4" onSubmit={event => event.preventDefault()}>
            <p className="rounded-md border-l-4 border-amber-500 bg-amber-50 p-3 text-sm text-amber-950">Before sharing, check that the note has no client, staff or vehicle identifiers or other private details. Shared notes remain unverified training content.</p>
            <label className="grid gap-1 text-sm font-medium" htmlFor={`learning-review-reason-${item.id}`}>Review feedback
              <textarea id={`learning-review-reason-${item.id}`} className="min-h-24 rounded-md border border-zinc-300 bg-white p-2" maxLength={3000} required value={reason} onChange={event => setReason(event.target.value)} disabled={mutation.isPending} />
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1 size-4" checked={shareWithAfterSales} onChange={event => setShareWithAfterSales(event.target.checked)} disabled={mutation.isPending} />
              <span>I checked that this note contains no client, staff or vehicle identifiers or other private details, and I want to share it with all after-sales staff at this site.</span>
            </label>
            {mutation.isError && <p role="alert" className="text-sm text-red-700">{mutation.error instanceof Error ? mutation.error.message : 'Could not save this review.'}</p>}
            <div className="flex flex-wrap gap-2">
              <Button disabled={!online || mutation.isPending || !reason.trim()} onClick={() => mutation.mutate({ decision: 'changes-requested' })}>Request changes</Button>
              <Button variant="secondary" disabled={!online || mutation.isPending || !reason.trim()} onClick={() => mutation.mutate({ decision: 'reviewed-learning-record', share: shareWithAfterSales })}>{shareWithAfterSales ? 'Mark reviewed and share' : 'Mark reviewed only'}</Button>
            </div>
          </form>
        </div>
      </details>
    </li>
  );
}
