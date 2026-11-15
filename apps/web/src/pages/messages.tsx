import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Mail, Send } from "lucide-react";
import { type FormEvent, useRef, useState } from "react";
import { z } from "zod";
import { ApiError, listSchema, request, sitePath, staffMessagesSchema, staffMessageSchema } from "../api";
import { useStaff } from "../workspace";
import { Button, dateTime, Empty, Failure, FormError, Loading, PageHeading, useOnline, useToast } from "../ui";

const rosterSchema = z.object({
  staff: z.array(z.object({ id: z.string().uuid(), displayName: z.string() })),
  staffTotalCount: z.number().int().nonnegative(),
  staffTotalPages: z.number().int().nonnegative(),
});
const createdMessageSchema = z.object({
  messageId: z.string().uuid(),
  createdAt: z.string().datetime({ offset: true }),
}).strict();
const readReceiptSchema = z.object({ messageId: z.string().uuid(), readAt: z.string().datetime({ offset: true }) }).strict();
type StaffMessage = z.infer<typeof staffMessageSchema>;

export function Messages() {
  const { session, site } = useStaff();
  const online = useOnline();
  const client = useQueryClient();
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [rosterPage, setRosterPage] = useState(1);
  const [recipients, setRecipients] = useState<string[]>([]);
  const [body, setBody] = useState("");
  const [workOrderId, setWorkOrderId] = useState("");
  const [workOrderPage, setWorkOrderPage] = useState(1);
  const [workOrderSearch, setWorkOrderSearch] = useState("");
  const [error, setError] = useState<unknown>(null);
  const sendAttempt = useRef<{ key: string; payload: string } | null>(null);
  const readAttempts = useRef(new Map<string, string>());
  const base = `${sitePath(site.id)}/staff/messages`;

  const messages = useQuery({
    queryKey: ["staff-messages", site.id, page],
    queryFn: () => request(`${base}?page=${page}&pageSize=25`, staffMessagesSchema),
    enabled: online,
    retry: false,
  });
  const canSend = Boolean(messages.data?.canSend && site.canWrite);
  const roster = useQuery({
    queryKey: ["staff-message-roster", site.id, rosterPage],
    queryFn: () => request(`${sitePath(site.id)}/staff/organogram?page=${rosterPage}&pageSize=50`, rosterSchema),
    enabled: online && canSend,
    retry: false,
  });
  const workOrders = useQuery({
    queryKey: ["staff-message-work-orders", site.id, workOrderSearch, workOrderPage],
    queryFn: () => {
      const params = new URLSearchParams({ q: workOrderSearch, queue: "all", page: String(workOrderPage), pageSize: "50" });
      return request(`${sitePath(site.id)}/work-orders?${params}`, listSchema);
    },
    enabled: online && canSend,
    retry: false,
  });

  const send = useMutation({
    mutationFn: (payload: { recipientUserIds: string[]; workOrderId: string | null; body: string }) => {
      const serialized = JSON.stringify(payload);
      if (!sendAttempt.current || sendAttempt.current.payload !== serialized)
        sendAttempt.current = { key: crypto.randomUUID(), payload: serialized };
      return request(base, createdMessageSchema, {
        method: "POST",
        commandId: sendAttempt.current.key,
        body: payload,
      });
    },
    onSuccess: async () => {
      sendAttempt.current = null;
      setBody("");
      setRecipients([]);
      setWorkOrderId("");
      setError(null);
      setPage(1);
      toast("Message sent to the selected staff.");
      await client.invalidateQueries({ queryKey: ["staff-messages", site.id] });
    },
    onError: (failure) => {
      setError(failure);
      if (failure instanceof ApiError && failure.status === 409) sendAttempt.current = null;
    },
  });

  const markRead = useMutation({
    mutationFn: (messageId: string) => {
      let commandId = readAttempts.current.get(messageId);
      if (!commandId) {
        commandId = crypto.randomUUID();
        readAttempts.current.set(messageId, commandId);
      }
      return request(`${base}/${encodeURIComponent(messageId)}/read`, readReceiptSchema, {
        method: "POST",
        commandId,
      });
    },
    onSuccess: async (receipt) => {
      readAttempts.current.delete(receipt.messageId);
      await client.invalidateQueries({ queryKey: ["staff-messages", site.id] });
    },
    onError: (failure) => setError(failure),
  });

  function toggleRecipient(userId: string) {
    setRecipients((current) => current.includes(userId)
      ? current.filter((id) => id !== userId)
      : [...current, userId]);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!recipients.length) {
      setError(new Error("Choose at least one staff member to receive this message."));
      return;
    }
    if (!body.trim()) {
      setError(new Error("Write a message before sending."));
      return;
    }
    if (body.trim().length > 5000) {
      setError(new Error("Messages can be up to 5,000 characters."));
      return;
    }
    send.mutate({ recipientUserIds: [...recipients].sort(), workOrderId: workOrderId || null, body: body.trim() });
  }

  if (!online) {
    return (
      <section className="panel max-w-3xl border-l-2 border-l-amber-600 p-6" aria-labelledby="messages-offline-title">
        <p className="text-xs font-semibold uppercase text-amber-800">Connection needed</p>
        <h1 id="messages-offline-title" className="mt-2 text-xl font-semibold text-zinc-950">Messages are unavailable offline</h1>
        <p className="mt-2 text-sm leading-6 text-zinc-600">Reconnect to load current messages or send a new one. Messages are not saved as drafts.</p>
      </section>
    );
  }
  if (messages.isPending) return <Loading label="Loading staff messages" />;
  if (messages.isError) return <Failure error={messages.error} retry={() => void messages.refetch()} />;

  return (
    <>
      <PageHeading eyebrow="Service-centre communication" title="Staff messages">
        Messages stay inside this service centre and are visible only to the sender and selected staff.
      </PageHeading>

      {site.canWrite && !messages.data.canSend && (
        <p role="status" className="panel mb-6 border-l-2 border-l-zinc-500 p-4 text-sm leading-6 text-zinc-700">
          Sending is not available for this account. Only the Head of Service Centre can send staff messages, and sending may be disabled while service-centre rules are being reviewed.
        </p>
      )}

      {canSend && (
        <section className="panel mb-8 border-t-2 border-t-sky-700 p-5 sm:p-6" aria-labelledby="compose-message-title">
          <div className="mb-5 flex items-start gap-3">
            <span className="mt-0.5 rounded-md border border-sky-200 bg-sky-50 p-2 text-sky-900"><Send className="size-4" aria-hidden="true" /></span>
            <div>
              <h2 id="compose-message-title" className="text-lg font-semibold text-zinc-950">Send a staff message</h2>
              <p className="mt-1 text-sm leading-6 text-zinc-600">Choose each recipient. They will see this message in their staff inbox.</p>
            </div>
          </div>

          {roster.isError && <Failure error={roster.error} retry={() => void roster.refetch()} />}
          {workOrders.isError && <Failure error={workOrders.error} retry={() => void workOrders.refetch()} />}
          <form onSubmit={submit} className="space-y-5">
            <fieldset disabled={send.isPending || roster.isPending}>
              <legend className="mb-2 text-sm font-semibold text-zinc-800">Recipients</legend>
              {roster.isPending ? <p className="text-sm text-zinc-500">Loading staff list…</p> : (
                <>
                  <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-zinc-200 p-2" role="group" aria-label="Choose staff recipients">
                    {roster.data?.staff.filter((person) => person.id !== session.user.id).map((person) => (
                      <label key={person.id} className="flex min-h-11 items-center gap-3 rounded-md px-3 py-2 text-sm text-zinc-800 hover:bg-zinc-50">
                        <input
                          type="checkbox"
                          checked={recipients.includes(person.id)}
                          onChange={() => toggleRecipient(person.id)}
                          className="size-4 accent-sky-800"
                        />
                        <span>{person.displayName}</span>
                      </label>
                    ))}
                    {!roster.data?.staff.filter((person) => person.id !== session.user.id).length && (
                      <p className="px-3 py-2 text-sm text-zinc-500">There are no other active staff accounts to select.</p>
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm text-zinc-600">
                    <span>{recipients.length} selected · {roster.data?.staffTotalCount ?? 0} active staff</span>
                    {(roster.data?.staffTotalPages ?? 0) > 1 && (
                      <div className="flex items-center gap-2">
                        <Button type="button" variant="secondary" disabled={rosterPage <= 1} onClick={() => setRosterPage((n) => n - 1)} aria-label="Previous staff page"><ArrowLeft className="size-4" aria-hidden="true" /></Button>
                        <span aria-live="polite">Page {rosterPage} of {roster.data?.staffTotalPages}</span>
                        <Button type="button" variant="secondary" disabled={rosterPage >= (roster.data?.staffTotalPages ?? 0)} onClick={() => setRosterPage((n) => n + 1)} aria-label="Next staff page"><ArrowRight className="size-4" aria-hidden="true" /></Button>
                      </div>
                    )}
                  </div>
                  {recipients.length > 50 && <p className="mt-1 text-sm text-red-800">Choose no more than 50 recipients.</p>}
                </>
              )}
            </fieldset>

            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
              <label className="block text-sm font-medium text-zinc-800" htmlFor="message-work-order">
                Job link <span className="font-normal text-zinc-500">(optional)</span>
                <select id="message-work-order" value={workOrderId} onChange={(event) => setWorkOrderId(event.target.value)} className="mt-1 block w-full" disabled={send.isPending}>
                  <option value="">No job link</option>
                  {workOrders.data?.items.map((order) => (
                    <option key={order.id} value={order.id}>{order.reference} · {order.registration || "Registration not recorded"}</option>
                  ))}
                </select>
                {workOrders.data && workOrders.data.pagination.totalPages > 1 && (
                  <span className="mt-2 flex items-center gap-2 text-xs font-normal text-zinc-600">
                    <label className="sr-only" htmlFor="message-job-search">Search job references</label>
                    <input id="message-job-search" value={workOrderSearch} onChange={(event) => { setWorkOrderSearch(event.target.value); setWorkOrderPage(1); setWorkOrderId(""); }} placeholder="Search jobs" className="min-w-0 flex-1" />
                    <Button type="button" variant="secondary" disabled={workOrderPage <= 1} onClick={() => setWorkOrderPage((n) => n - 1)} aria-label="Previous job page"><ArrowLeft className="size-4" aria-hidden="true" /></Button>
                    <span>Page {workOrderPage} of {workOrders.data.pagination.totalPages}</span>
                    <Button type="button" variant="secondary" disabled={workOrderPage >= workOrders.data.pagination.totalPages} onClick={() => setWorkOrderPage((n) => n + 1)} aria-label="Next job page"><ArrowRight className="size-4" aria-hidden="true" /></Button>
                  </span>
                )}
              </label>
              <label className="block text-sm font-medium text-zinc-800" htmlFor="message-body">
                Message
                <textarea id="message-body" value={body} onChange={(event) => setBody(event.target.value)} maxLength={5000} rows={5} className="mt-1 block w-full resize-y" placeholder="Write a clear message for your colleagues." disabled={send.isPending} aria-describedby="message-count" />
                <span id="message-count" className="mt-1 block text-right text-xs font-normal text-zinc-500">{body.length} of 5,000 characters</span>
              </label>
            </div>
            {error !== null && <FormError error={error} />}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 pt-4">
              <p className="text-xs leading-5 text-zinc-500">Messages cannot be changed or deleted after sending.</p>
              <Button type="submit" disabled={send.isPending || !recipients.length || recipients.length > 50 || !body.trim()}>
                <Send className="size-4" aria-hidden="true" />
                {send.isPending ? "Sending…" : "Send message"}
              </Button>
            </div>
          </form>
        </section>
      )}

      <section aria-labelledby="inbox-heading">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="inbox-heading" className="text-lg font-semibold text-zinc-950">Your messages</h2>
            <p className="mt-1 text-sm text-zinc-600">Messages sent to you and messages you sent.</p>
          </div>
          {messages.data.totalPages > 1 && (
            <nav aria-label="Message pages" className="flex items-center gap-2">
              <Button type="button" variant="secondary" disabled={page <= 1} onClick={() => setPage((n) => n - 1)} aria-label="Previous message page"><ArrowLeft className="size-4" aria-hidden="true" /></Button>
              <span role="status" aria-live="polite">Page {messages.data.page} of {messages.data.totalPages}</span>
              <Button type="button" variant="secondary" disabled={page >= messages.data.totalPages} onClick={() => setPage((n) => n + 1)} aria-label="Next message page"><ArrowRight className="size-4" aria-hidden="true" /></Button>
            </nav>
          )}
        </div>
        {!messages.data.items.length ? (
          <Empty title="No staff messages yet">Messages sent to you will appear here.</Empty>
        ) : (
          <ul className="space-y-3">
            {messages.data.items.map((message) => (
              <MessageCard key={message.id} message={message} currentUserId={session.user.id} siteTimeZone={site.timeZone} canMarkRead={online && !message.readAt && message.senderUserId !== session.user.id} markRead={() => markRead.mutate(message.id)} busy={markRead.isPending && markRead.variables === message.id} />
            ))}
          </ul>
        )}
        {markRead.isError && <div className="mt-4"><Failure error={markRead.error} retry={() => markRead.variables && markRead.mutate(markRead.variables)} /></div>}
      </section>
    </>
  );
}

function MessageCard({ message, currentUserId, siteTimeZone, canMarkRead, markRead, busy }: {
  message: StaffMessage;
  currentUserId: string;
  siteTimeZone: string;
  canMarkRead: boolean;
  markRead: () => void;
  busy: boolean;
}) {
  const sentByMe = message.senderUserId === currentUserId;
  return (
    <li className="panel min-w-0 border-l-2 border-l-sky-700 p-4 sm:p-5">
      <article aria-labelledby={`message-${message.id}-title`}>
        <header className="flex min-w-0 flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 shrink-0 rounded-md border border-zinc-200 bg-zinc-50 p-2 text-zinc-700"><Mail className="size-4" aria-hidden="true" /></span>
            <div className="min-w-0">
              <h3 id={`message-${message.id}-title`} className="font-semibold text-zinc-950">{sentByMe ? "Sent by you" : `From ${message.senderName}`}</h3>
              <p className="mt-1 text-xs text-zinc-500"><time dateTime={message.createdAt}>{dateTime(message.createdAt, siteTimeZone)}</time></p>
            </div>
          </div>
          {sentByMe && <span className="rounded border border-sky-200 px-2 py-1 text-xs font-medium text-sky-900">Sent</span>}
        </header>
        {message.workOrderReference && (
          <p className="ml-11 mt-3 text-sm text-zinc-600">Job <span className="font-mono font-medium text-zinc-900">{message.workOrderReference}</span></p>
        )}
        <p className="ml-11 mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-zinc-800">{message.body}</p>
        <div className="ml-11 mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 pt-3 text-xs text-zinc-500">
          <p>
            {sentByMe
              ? `To: ${message.recipients.map((recipient) => `${recipient.displayName}${recipient.readAt ? " (read)" : ""}`).join(", ")}`
              : message.readAt ? `Read ${dateTime(message.readAt, siteTimeZone)}` : "Not marked as read"}
          </p>
          {canMarkRead && <Button type="button" variant="secondary" disabled={busy} onClick={markRead}>{busy ? "Saving…" : "Mark as read"}</Button>}
        </div>
      </article>
    </li>
  );
}
