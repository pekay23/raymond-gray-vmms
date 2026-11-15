import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { ApiError, request, sitePath, vehicleLearningLibrarySchema, vehicleLearningShareRevocationSchema, type VehicleLearningLibrary } from './api';
import { AssessmentSnapshot } from './vehicle-learning-activity';
import { Button, Empty, Failure, Loading, dateTime, useOnline, useToast } from './ui';

export function VehicleLearningLibrary({ siteId, timeZone }: { siteId: string; timeZone: string }) {
  const online = useOnline();
  const toast = useToast();
  const client = useQueryClient();
  const [searchText, setSearchText] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [revokeTarget, setRevokeTarget] = useState<string | null>(null);
  const [revokeReason, setRevokeReason] = useState('');
  const revokeAttempt = useRef<{ payload: string; key: string } | null>(null);
  const library = useQuery({
    queryKey: ['vehicle-learning-library', siteId, query, page],
    queryFn: () => {
      const params = new URLSearchParams({ q: query, page: String(page), pageSize: '20' });
      return request(`${sitePath(siteId)}/vehicle-learning/library?${params}`, vehicleLearningLibrarySchema);
    },
    enabled: online,
    retry: false,
  });
  const revoke = useMutation({
    mutationFn: (item: VehicleLearningLibrary['items'][number]) => {
      const body = { revisionNumber: item.revisionNumber, reason: revokeReason };
      const payload = JSON.stringify({ entryId: item.entryId, ...body });
      if (!revokeAttempt.current || revokeAttempt.current.payload !== payload)
        revokeAttempt.current = { payload, key: crypto.randomUUID() };
      return request(`${sitePath(siteId)}/vehicle-learning/${encodeURIComponent(item.entryId)}/library-share/revocations`, vehicleLearningShareRevocationSchema, {
        method: 'POST', commandId: revokeAttempt.current.key, body,
      });
    },
    onSuccess: async () => {
      revokeAttempt.current = null;
      setRevokeTarget(null);
      setRevokeReason('');
      toast('Removed from the shared learning library. Review history is retained.');
      await client.invalidateQueries({ queryKey: ['vehicle-learning-library', siteId] });
    },
    onError: async error => {
      if (error instanceof ApiError && error.status === 409) revokeAttempt.current = null;
      await client.invalidateQueries({ queryKey: ['vehicle-learning-library', siteId] });
    },
  });

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setQuery(searchText.trim());
    setPage(1);
  }

  return (
    <section className="rounded-xl border border-sky-200 bg-white p-5 shadow-sm" aria-labelledby="vehicle-learning-library-heading">
      <h2 id="vehicle-learning-library-heading" className="text-xl font-semibold">Learning notes shared by the team</h2>
      <p className="mt-2 rounded-md border-l-4 border-sky-500 bg-sky-50 p-3 text-sm text-sky-950">
        Reviewed learning notes are unverified training content. They are not OEM-confirmed references, work instructions, diagnoses, qualifications or permission to perform work. Check the cited source and keep unknowns open.
      </p>
      <form className="mt-4 flex flex-wrap items-end gap-3" onSubmit={search} role="search">
        <label className="grid min-w-0 flex-1 gap-1 text-sm font-medium" htmlFor="vehicle-learning-library-search">Find a make, model or note
          <input id="vehicle-learning-library-search" className="rounded-md border border-zinc-300 p-2" value={searchText} onChange={event => setSearchText(event.target.value)} maxLength={120} />
        </label>
        <Button type="submit" variant="secondary" disabled={!online}>Search notes</Button>
      </form>
      {!online && !library.data && <p role="status" className="mt-4 text-sm text-amber-800">Connect to view shared learning notes.</p>}
      {library.isLoading && <Loading label="Loading shared learning notes" />}
      {library.isError && <Failure error={library.error} retry={() => void library.refetch()} />}
      {library.data && library.data.items.length === 0 && <Empty title="No shared notes found">
        {query ? 'Try another make, model or note title.' : 'A note appears here after its author submits it and a reviewer explicitly shares the reviewed revision with after-sales staff.'}
      </Empty>}
      {library.data && library.data.items.length > 0 && (
        <>
          <p className="mt-4 text-sm text-zinc-600">{library.data.total} {library.data.total === 1 ? 'note' : 'notes'} · page {library.data.page} of {library.data.totalPages}</p>
          <ul className="mt-2 divide-y divide-zinc-200">
            {library.data.items.map(item => (
              <li key={`${item.entryId}-${item.revisionNumber}`} className="py-3">
                <details>
                  <summary className="cursor-pointer rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
                    <span className="font-medium">{item.makeModel} · {item.title}</span>
                    <span className="mt-1 block text-sm text-zinc-600">Reviewed learning note · version {item.revisionNumber} · {dateTime(item.reviewedAt, timeZone)}</span>
                  </summary>
                  <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">Unverified training content. Confirm technical facts against current approved model-specific sources before using them in workshop work.</div>
                  {library.data.canManageSharing && (
                    <div className="mt-3">
                      {revokeTarget === `${item.entryId}:${item.revisionNumber}` ? (
                        <form className="space-y-2 rounded-md border border-red-200 bg-red-50 p-3" onSubmit={event => event.preventDefault()}>
                          <label className="grid gap-1 text-sm font-medium" htmlFor={`learning-revoke-reason-${item.entryId}`}>Why should this note be removed?
                            <textarea id={`learning-revoke-reason-${item.entryId}`} className="min-h-20 rounded-md border border-zinc-300 bg-white p-2" value={revokeReason} onChange={event => setRevokeReason(event.target.value)} maxLength={1000} required disabled={revoke.isPending} />
                          </label>
                          <p className="text-xs text-zinc-700">This hides the note from the team library. Its original review history is retained.</p>
                          {revoke.isError && <p role="alert" className="text-sm text-red-800">{revoke.error instanceof Error ? revoke.error.message : 'Could not remove this note.'}</p>}
                          <div className="flex flex-wrap gap-2">
                            <Button variant="danger" disabled={!online || revoke.isPending || !revokeReason.trim()} onClick={() => revoke.mutate(item)}>Remove from library</Button>
                            <Button type="button" variant="secondary" disabled={revoke.isPending} onClick={() => { setRevokeTarget(null); setRevokeReason(''); }}>Cancel</Button>
                          </div>
                        </form>
                      ) : (
                        <Button variant="secondary" disabled={!online} onClick={() => { setRevokeTarget(`${item.entryId}:${item.revisionNumber}`); setRevokeReason(''); }}>Remove from shared library</Button>
                      )}
                    </div>
                  )}
                  <AssessmentSnapshot assessment={item.assessment} />
                </details>
              </li>
            ))}
          </ul>
          <nav className="mt-4 flex items-center justify-between gap-3" aria-label="Learning library pages">
            <Button variant="secondary" disabled={library.data.page <= 1} onClick={() => setPage(current => Math.max(1, current - 1))}>Previous</Button>
            <span aria-live="polite" className="text-sm text-zinc-600">Page {library.data.page} of {library.data.totalPages}</span>
            <Button variant="secondary" disabled={library.data.page >= library.data.totalPages} onClick={() => setPage(current => current + 1)}>Next</Button>
          </nav>
        </>
      )}
    </section>
  );
}
