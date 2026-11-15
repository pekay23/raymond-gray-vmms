import { useQuery } from "@tanstack/react-query";
import { BookOpen, ChevronLeft, ChevronRight, Download, Search } from "lucide-react";
import { type FormEvent, useState } from "react";
import { controlledDocumentDownloadPath, controlledDocumentsPath, controlledDocumentsSchema, request } from "../api";
import { useStaff } from "../workspace";
import { Button, dateTime, Empty, Failure, Loading, PageHeading, useOnline } from "../ui";

const pageSize = 25;

export function Documents() {
  const { site } = useStaff();
  const online = useOnline();
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const documents = useQuery({
    queryKey: ["controlled-documents", site.id, search, page, pageSize],
    queryFn: () => request(
      controlledDocumentsPath(site.id, search, page, pageSize),
      controlledDocumentsSchema,
    ),
    enabled: online,
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPage(1);
    setSearch(searchDraft.trim());
  }

  function clearSearch() {
    setSearchDraft("");
    setSearch("");
    setPage(1);
  }

  if (!online) {
    return (
      <section className="panel max-w-3xl border-l-2 border-l-amber-600 p-6" aria-labelledby="documents-offline-title">
        <p className="text-xs font-semibold uppercase text-amber-800">Connection needed</p>
        <h1 id="documents-offline-title" className="mt-2 text-xl font-semibold text-zinc-950">Documents are unavailable offline</h1>
        <p className="mt-2 text-sm leading-6 text-zinc-600">Reconnect to load the current approved procedures. Documents are not saved for offline use.</p>
      </section>
    );
  }

  if (documents.isPending) return <Loading label="Loading current procedures" />;
  if (documents.isError) return <Failure error={documents.error} retry={() => void documents.refetch()} />;

  const result = documents.data;
  const { pagination } = result;
  const currentPage = Math.min(pagination.page, pagination.totalPages || 1);

  return (
    <>
      <PageHeading eyebrow="Service-centre reference" title="Documents">
        Browse procedures approved for use at this service centre. Drafts, documents under review, and replaced versions are not shown.
      </PageHeading>

      <section className="panel overflow-hidden" aria-labelledby="procedure-library-title">
        <div className="border-b border-zinc-200 p-5 sm:p-6">
          <div className="mb-5 flex items-start gap-3">
            <span className="mt-0.5 rounded-md border border-zinc-200 bg-zinc-50 p-2 text-zinc-800">
              <BookOpen className="size-4" aria-hidden="true" />
            </span>
            <div>
              <h2 id="procedure-library-title" className="text-lg font-semibold text-zinc-950">Current procedures</h2>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-zinc-600">Only current procedures are shown. They do not replace the checks or approvals required before work starts.</p>
            </div>
          </div>

          <form className="flex flex-col gap-3 sm:flex-row" role="search" aria-label="Search current procedures" onSubmit={submit}>
            <div className="relative min-w-0 flex-1">
              <label htmlFor="document-search" className="sr-only">Search by title, reference, or another name</label>
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" aria-hidden="true" />
              <input
                id="document-search"
                className="w-full pl-10"
                type="search"
                maxLength={160}
                value={searchDraft}
                onChange={(event) => setSearchDraft(event.target.value)}
                placeholder="Title, reference, or another name"
                autoComplete="off"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="secondary" disabled={searchDraft.trim() === search}>
                Search
              </Button>
              {search && <Button type="button" variant="secondary" onClick={clearSearch}>Clear search</Button>}
            </div>
          </form>
        </div>

        {result.documents.length === 0 ? (
          <div className="px-5 sm:px-6">
            <Empty title={search ? "No matching procedures" : "No current procedures available"}>
              {search
                ? "Try another title, reference, or name. Only procedures marked as current appear in search."
                : "No procedures are marked as current for this service centre yet. Ask the Head of Service Centre if you expected to see one here."}
            </Empty>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 px-5 py-3 text-sm text-zinc-600 sm:px-6" role="status" aria-live="polite">
              <span>{pagination.totalItems === 1 ? "1 current procedure" : `${pagination.totalItems} current procedures`}</span>
              {pagination.totalPages > 1 && <span>Page {currentPage} of {pagination.totalPages}</span>}
            </div>
            <ul className="divide-y divide-zinc-100">
              {result.documents.map((document) => (
                <li key={document.documentId}>
                  <article className="border-l-2 border-l-zinc-300 px-5 py-5 sm:px-6">
                    <div className="flex min-w-0 flex-col gap-4 md:flex-row md:items-start md:justify-between">
                      <div className="min-w-0">
                        <h3 className="break-words text-base font-semibold text-zinc-950">{document.title}</h3>
                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-zinc-600">
                          <span><span className="text-zinc-500">Reference</span> <span className="font-mono text-zinc-800">{document.reference}</span></span>
                          <span><span className="text-zinc-500">Version</span> <span className="font-medium text-zinc-800">{document.revision}</span></span>
                          {document.alias && <span><span className="text-zinc-500">Also called</span> {document.alias}</span>}
                        </div>
                      </div>
                      <dl className="grid shrink-0 gap-x-6 gap-y-3 text-sm sm:grid-cols-2 md:grid-cols-1 lg:grid-cols-2">
                        <div>
                          <dt className="text-xs text-zinc-500">Maintained by</dt>
                          <dd className="mt-1 break-words font-medium text-zinc-800">{document.ownerName}</dd>
                        </div>
                        <div>
                          <dt className="text-xs text-zinc-500">Current since</dt>
                          <dd className="mt-1 text-zinc-800"><time dateTime={document.effectiveFrom}>{dateTime(document.effectiveFrom, site.timeZone)}</time></dd>
                        </div>
                        {document.reviewDueAt && (
                          <div>
                            <dt className="text-xs text-zinc-500">Review due</dt>
                            <dd className="mt-1 text-zinc-800"><time dateTime={document.reviewDueAt}>{dateTime(document.reviewDueAt, site.timeZone)}</time></dd>
                          </div>
                        )}
                      </dl>
                    </div>
                    <a
                      className="button button-secondary mt-4 inline-flex"
                      href={`/api/v1${controlledDocumentDownloadPath(site.id, document.documentId)}`}
                      aria-label={`Download current version of ${document.title}`}
                    >
                      <Download className="size-4" aria-hidden="true" />
                      <span>Download current version</span>
                    </a>
                  </article>
                </li>
              ))}
            </ul>
          </>
        )}

        {pagination.totalPages > 1 && (
          <nav className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200 px-5 py-4 sm:px-6" aria-label="Procedure pages">
            <p className="text-sm text-zinc-600">Page {currentPage} of {pagination.totalPages}</p>
            <div className="flex gap-2">
              <Button type="button" variant="secondary" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={currentPage <= 1}>
                <ChevronLeft className="size-4" aria-hidden="true" />
                <span>Previous</span>
              </Button>
              <Button type="button" variant="secondary" onClick={() => setPage((value) => Math.min(pagination.totalPages, value + 1))} disabled={currentPage >= pagination.totalPages}>
                <span>Next</span>
                <ChevronRight className="size-4" aria-hidden="true" />
              </Button>
            </div>
          </nav>
        )}
      </section>
    </>
  );
}
