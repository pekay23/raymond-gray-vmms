import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import {
  request,
  sitePath,
  vehicleLearningActivitySchema,
  vehicleLearningCommentResultSchema,
} from './api';
import { Button, Empty, Failure, Loading, useOnline, useToast } from './ui';
import { dateTime } from './ui';
import { learningQuestionItems, learningSystemGroups, type VehicleLearningAssessment } from './vehicle-learning-assessment';

export function VehicleLearningActivity({ entryId, siteId, timeZone, accessScope = 'author' }: {
  entryId: string; siteId: string; timeZone: string; accessScope?: 'author' | 'reviewer';
}) {
  const online = useOnline();
  const client = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [commentRevision, setCommentRevision] = useState<number | null>(null);
  const [commentBody, setCommentBody] = useState('');
  const [error, setError] = useState('');
  const commandAttempt = useRef<{ key: string; payload: string } | null>(null);
  const activityPath = `${sitePath(siteId)}/vehicle-learning/${encodeURIComponent(entryId)}/activity`;
  const activity = useQuery({
    queryKey: ['vehicle-learning-activity', siteId, entryId],
    queryFn: () => request(activityPath, vehicleLearningActivitySchema),
    enabled: open && online,
    retry: false,
  });
  const comment = useMutation({
    mutationFn: (revisionNumber: number) => {
      const body = { revisionNumber, body: commentBody };
      const payload = JSON.stringify(body);
      if (!commandAttempt.current || commandAttempt.current.payload !== payload) {
        commandAttempt.current = { key: crypto.randomUUID(), payload };
      }
      return request(`${sitePath(siteId)}/vehicle-learning/${encodeURIComponent(entryId)}/comments`, vehicleLearningCommentResultSchema, {
        method: 'POST',
        commandId: commandAttempt.current.key,
        body,
      });
    },
    onSuccess: async () => {
      commandAttempt.current = null;
      setCommentBody('');
      setCommentRevision(null);
      setError('');
      toast('Comment added to the saved version.');
      await client.invalidateQueries({ queryKey: ['vehicle-learning-activity', siteId, entryId] });
    },
    onError: errorValue => setError(errorValue instanceof Error ? errorValue.message : 'Could not add this comment.'),
  });

  return (
    <div className="mt-3 border-t border-zinc-200 pt-3">
      <Button variant="secondary" aria-expanded={open} onClick={() => setOpen(value => !value)}>
        {open ? 'Hide history and comments' : 'History and comments'}
      </Button>
      {open && (
        <div className="mt-4 space-y-4">
          {!online && !activity.data && <p className="text-sm text-amber-800">Connect to load this learning history.</p>}
          {activity.isLoading && <Loading label="Loading learning history" />}
          {activity.isError && <Failure error={activity.error} retry={() => void activity.refetch()} />}
          {activity.data && activity.data.revisions.length === 0 && <Empty title="No saved versions">Save this exercise to start its history.</Empty>}
          {activity.data?.revisions.map(revision => {
            const comments = activity.data.comments.filter(item => item.revisionNumber === revision.revisionNumber);
            const reviews = activity.data.reviews.filter(item => item.revisionNumber === revision.revisionNumber);
            return (
              <article key={revision.revisionNumber} className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                  <h3 className="font-semibold text-zinc-900">Version {revision.revisionNumber} · {revision.status === 'submitted' ? 'Submitted for review' : 'Draft'}</h3>
                    <p className="mt-1 text-sm text-zinc-600">{revision.title} · {revision.makeModel} · {revision.powertrain} · {revision.drivetrain}</p>
                  </div>
                  <time dateTime={revision.savedAt} className="text-xs text-zinc-500">{dateTime(revision.savedAt, timeZone)}</time>
                </div>
                <AssessmentSnapshot assessment={revision.assessment} />
                <div className="mt-4 border-t border-zinc-200 pt-3">
                  <h4 className="text-sm font-medium">Comments on version {revision.revisionNumber}</h4>
                  {comments.length === 0 ? <p className="mt-2 text-sm text-zinc-500">No follow-up comments.</p> : <ol className="mt-2 space-y-2">{comments.map(item => <li key={item.id} className="rounded-md border border-zinc-200 bg-white p-3"><p className="whitespace-pre-wrap break-words text-sm text-zinc-800">{item.body}</p><p className="mt-2 text-xs text-zinc-500">{item.commenterName} · <time dateTime={item.createdAt}>{dateTime(item.createdAt, timeZone)}</time></p></li>)}</ol>}
                  {reviews.length > 0 && <section aria-label={`Review decisions for version ${revision.revisionNumber}`} className="mt-3 space-y-2 border-l-2 border-l-blue-600 pl-3">
                    {reviews.map(review => <article key={review.id}>
                      <p className="text-sm font-semibold">{review.decision === 'changes-requested' ? 'Changes requested' : 'Reviewed as a learning note'}</p>
                      <p className="whitespace-pre-wrap break-words text-sm text-zinc-700">{review.reason}</p>
                      <p className="text-xs text-zinc-500">{review.reviewerName} · <time dateTime={review.createdAt}>{dateTime(review.createdAt, timeZone)}</time></p>
                      {review.decision === 'reviewed-learning-record' && <p className="text-xs text-zinc-600">This does not verify vehicle facts or approve work.</p>}
                    </article>)}
                  </section>}
                  {(accessScope === 'author' || revision.status === 'submitted' && reviews.length === 0) && <Button variant="secondary" className="mt-3" disabled={!online || comment.isPending} onClick={() => { setError(''); setCommentRevision(revision.revisionNumber); }}>Add a comment</Button>}
                  {commentRevision === revision.revisionNumber && <form className="mt-3 space-y-2" onSubmit={event => { event.preventDefault(); comment.mutate(revision.revisionNumber); }}>
                    <label htmlFor={`learning-comment-${entryId}-${revision.revisionNumber}`} className="block text-sm font-medium">Your comment on version {revision.revisionNumber}</label>
                    <textarea id={`learning-comment-${entryId}-${revision.revisionNumber}`} className="min-h-24 w-full rounded-md border border-zinc-300 bg-white p-2 text-sm" maxLength={3000} required value={commentBody} onChange={event => setCommentBody(event.target.value)} disabled={comment.isPending} />
                    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
                    <div className="flex flex-wrap gap-2"><Button disabled={!online || comment.isPending || !commentBody.trim()}>Save comment</Button><Button type="button" variant="secondary" disabled={comment.isPending} onClick={() => { setCommentRevision(null); setError(''); }}>Cancel</Button>{!online && <span className="self-center text-sm text-amber-800">Connect to save this comment.</span>}</div>
                  </form>}
                </div>
              </article>
            );
          })}
          {activity.isSuccess && <p className="text-xs text-zinc-500">{accessScope === 'reviewer'
            ? 'You can read this submitted note because you have a separate learning-review permission. Review feedback is not technical approval.'
            : 'Drafts are private to you. Submitted notes are visible only to staff with a current, separate learning-review permission; a comment or review does not approve vehicle information.'}</p>}
        </div>
      )}
    </div>
  );
}

export function AssessmentSnapshot({ assessment }: { assessment: VehicleLearningAssessment }) {
  return (
    <details className="mt-3 rounded-md border border-zinc-200 bg-white p-3">
      <summary className="cursor-pointer text-sm font-medium">View answers and evidence</summary>
      <div className="mt-3 space-y-4 text-sm">
        <section>
          <h4 className="font-semibold">First look</h4>
          <p>Body style and size: {assessment.preliminary.bodyStyleAndApproximateSize || 'Not recorded'}</p>
          <p>Vehicle type guess: {assessment.preliminary.vehicleType.answer} · {assessment.preliminary.vehicleType.confidence}</p>
          <p>Drivetrain guess: {assessment.preliminary.drivetrain.answer} · {assessment.preliminary.drivetrain.confidence}</p>
          <p>Visible clues: {assessment.preliminary.visibleClues.filter(Boolean).join('; ') || 'Not recorded'}</p>
          {assessment.preliminary.assumptions && <p className="whitespace-pre-wrap break-words">Assumptions: {assessment.preliminary.assumptions}</p>}
          <Citations citations={assessment.preliminary.vehicleType.citations} />
        </section>
        <section>
          <h4 className="font-semibold">Evidence checks</h4>
          <ul className="mt-1 space-y-2">{learningQuestionItems.map(([key, prompt]) => {
            const finding = assessment.technicalFindings[key]!;
            return <li key={key} className="rounded border border-zinc-100 p-2">
              <p className="font-medium">{prompt}</p>
              <p className="whitespace-pre-wrap break-words">{finding.answer || 'No answer'} · {finding.state} · confidence: {finding.confidence}</p>
              {finding.uncertainty && <p className="whitespace-pre-wrap break-words">Still unknown: {finding.uncertainty}</p>}
              <Citations citations={finding.citations} />
            </li>;
          })}</ul>
        </section>
        <section>
          <h4 className="font-semibold">System register</h4>
          <div className="mt-1 space-y-3">{learningSystemGroups.map(group => <div key={group.title}>
            <h5 className="font-medium">{group.title}</h5>
            <ul className="mt-1 space-y-1">{group.items.map(([key, label]) => {
              const item = assessment.systems[key]!;
              return <li key={key} className="break-words">{label}: {item.state} · {item.notes || 'No note'}{item.nonInvasiveLocationOrSource && ` · ${item.nonInvasiveLocationOrSource}`}<Citations citations={item.citations} /></li>;
            })}</ul>
          </div>)}</div>
        </section>
        <section>
          <h4 className="font-semibold">Energy flow</h4>
          {([
            ['Driving', assessment.energyPaths.driving], ['AC charging', assessment.energyPaths.acCharging],
            ['DC charging', assessment.energyPaths.dcCharging], ['Regenerative braking', assessment.energyPaths.regenerativeBraking],
          ] as const).map(([label, path]) => <div key={label} className="mt-1">
            <p className="font-medium">{label} · {path.applicability}</p>
            <p className="whitespace-pre-wrap break-words">{path.explanation || 'No explanation recorded'}{path.unknowns && ` · Unknowns: ${path.unknowns}`}</p>
            <Citations citations={path.citations} />
          </div>)}
        </section>
        <section>
          <h4 className="font-semibold">Technical explanations</h4>
          <ul className="mt-1 space-y-1">
            <li>Inverter, DC/DC converter and onboard charger: {assessment.explanations.inverterDcDcAndOnboardCharger || 'Not answered'}</li>
            <li>PHEV and EREV evidence: {assessment.explanations.phevVersusErev || 'Not answered'}</li>
            <li>Driven-axle evidence: {assessment.explanations.evidenceForDrivenAxles || 'Not answered'}</li>
            <li>Safely checking hidden systems: {assessment.explanations.safelyVerifyingHiddenSystems || 'Not answered'}</li>
          </ul>
          {assessment.learnerQuestions && <p className="mt-2 whitespace-pre-wrap break-words">Questions: {assessment.learnerQuestions}</p>}
        </section>
        {assessment.legacy && <details className="rounded border border-amber-200 bg-amber-50 p-2">
          <summary className="cursor-pointer font-medium">Earlier unstructured answers</summary>
          <p className="mt-2">Earlier type/drivetrain selections are hypotheses only: {assessment.legacy.originalPowertrain} · {assessment.legacy.originalDrivetrain}</p>
          <p>Earlier evidence: {assessment.legacy.originalEvidence || 'None recorded'}</p>
          <p>Earlier questions: {assessment.legacy.originalQuestions || 'None recorded'}</p>
        </details>}
      </div>
    </details>
  );
}

function Citations({ citations }: { citations: VehicleLearningAssessment['preliminary']['vehicleType']['citations'] }) {
  if (!citations.length) return null;
  return <ul className="mt-1 text-xs text-zinc-600">{citations.map((citation, index) => <li key={`${citation.sourceTitle}-${index}`}>
    Source: {citation.sourceTitle} · {citation.kind} · {citation.revisionOrDate} · {citation.pageOrSection}
  </li>)}</ul>;
}
