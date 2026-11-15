import { useEffect, useRef, useState } from "react";
import type { FormEvent, InputHTMLAttributes } from "react";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowRight, ClipboardList, Save, ShieldAlert } from "lucide-react";
import { ApiError, clientMatchSchema, detailSchema, partyMatchSchema, request, sitePath, vehicleMatchSchema } from "../api";
import { emptyIntake, loadDraft, loadRequestIntakeDraft, removeDraft, removeRequestIntakeDraft, saveDraft, saveRequestIntakeDraft } from "../drafts";
import type { IntakeDraft, IntakeFields } from "../drafts";
import { BackToQueue, useStaff } from "../workspace";
import { VinScanner } from "../vin-scanner";
import {
  Badge,
  Button,
  FormError,
  Failure,
  Loading,
  PageHeading,
  dateTime,
  useOnline,
  useToast,
} from "../ui";

function Field({
  label,
  hint,
  id,
  error,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
  id: string;
  error?: string | undefined;
}) {
  return (
    <div>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={[hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(" ") || undefined}
        {...props}
      />
      {hint && (
        <p id={`${id}-hint`} className="field-hint">
          {hint}
        </p>
      )}
      {error && <p id={`${id}-error`} className="mt-1 text-sm font-normal text-red-800">{error}</p>}
    </div>
  );
}

export function Intake() {
  const params=useParams(),parsed=z.string().uuid().safeParse(params.requestId);
  if(params.requestId&&!parsed.success) return <p role="alert">This request link is invalid.</p>;
  return parsed.success?<RequestIntake key={parsed.data} requestId={parsed.data}/>:<IntakeForm/>;
}

const requestIntakeSourceSchema = z.object({
  id: z.string().uuid(), version: z.number().int().positive(), status: z.string(),
  sourceChannel: z.string(), concern: z.string(), reportedContactName: z.string().nullable(),
  reportedContactPhone: z.string().nullable(),
  reportedContactRelationship: z.enum(['vehicle-owner','driver','client-contact','sales-contact','other','unknown']),
  reportedVehicle: z.string().nullable(), reportedClient: z.string().nullable(),
  nextAction: z.string().nullable(), callbackDueAt: z.string().nullable(),
  workOrderId: z.string().uuid().nullable(),
});

function RequestIntake({requestId}:{requestId:string}) {
  const {site,session}=useStaff();
  const source=useQuery({queryKey:['request-detail',site.id,requestId],queryFn:()=>request(`${sitePath(site.id)}/service-requests/${requestId}`,requestIntakeSourceSchema)});
  const [saved]=useState(()=>loadRequestIntakeDraft(session.user.id,site.id,requestId));
  if(source.isPending)return <Loading label="Loading request"/>;
  if(source.isError)return <Failure error={source.error} retry={()=>void source.refetch()}/>;
  if(source.data.status!=='open'&&!saved.draft)return <div className="panel p-5"><p>{source.data.status==='converted'?'This request is already linked to a job.':'This request is closed and cannot create a job.'}</p>{source.data.workOrderId&&<Link className="text-blue-700 underline" to={`/sites/${site.id}/work-orders/${source.data.workOrderId}`}>Open linked job</Link>}</div>;
  return <IntakeForm source={{id:requestId,version:saved.draft?.requestVersion??source.data.version,concern:source.data.concern,request:source.data}}/>;
}

const requestRelationshipLabel: Record<z.infer<typeof requestIntakeSourceSchema>['reportedContactRelationship'], string> = {
  'vehicle-owner':'Vehicle owner', driver:'Driver', 'client-contact':'Paying client contact',
  'sales-contact':'Sales team contact', other:'Other', unknown:'Not known yet',
};

function IntakeForm({source}:{source?:{id:string;version:number;concern:string;request:z.infer<typeof requestIntakeSourceSchema>}}) {
  const { site, session } = useStaff();
  const navigate = useNavigate();
  const client = useQueryClient();
  const online = useOnline();
  const notify = useToast();
  const [initial] = useState(() => source?loadRequestIntakeDraft(session.user.id,site.id,source.id):loadDraft(session.user.id, site.id));
  const saveVisitDraft=(draft:IntakeDraft)=>source?saveRequestIntakeDraft(session.user.id,site.id,source.id,{...draft,requestVersion:source.version}):saveDraft(session.user.id,site.id,draft);
  const removeVisitDraft=()=>source?removeRequestIntakeDraft(session.user.id,site.id,source.id):removeDraft(session.user.id,site.id);
  const [confirmed,setConfirmed]=useState(false);
  const [fields, setFields] = useState<IntakeFields>(
    initial.draft?.fields ?? (source?{...emptyIntake,complaint:source.concern}:emptyIntake),
  );
  const [selectionIds, setSelectionIds] = useState({
    client: initial.draft?.selectedClientId ?? null,
    vehicle: initial.draft?.selectedVehicleId ?? null,
  });
  const [selectionReview, setSelectionReview] = useState({
    client: initial.draft?.clientSelectionNeedsReview ?? false,
    vehicle: initial.draft?.vehicleSelectionNeedsReview ?? false,
  });
  const [selectionFallbackAllowed, setSelectionFallbackAllowed] = useState({ client: false, vehicle: false });
  const [vehicleMatch, setVehicleMatch] = useState<z.infer<typeof vehicleMatchSchema>>(null);
  const [selectedVehicle, setSelectedVehicle] = useState<NonNullable<z.infer<typeof vehicleMatchSchema>> | null>(null);
  const [selectedClient, setSelectedClient] = useState<z.infer<typeof clientMatchSchema>[number] | null>(null);
  const [selectionMessage, setSelectionMessage] = useState<string | null>(null);
  const [selectionAnnouncement, setSelectionAnnouncement] = useState("");
  const [selectionRevision, setSelectionRevision] = useState(0);
  const selectionFocusId = useRef<string | null>(null);
  const [storageError, setStorageError] = useState<string | null>(
    initial.error,
  );
  const [savedAt, setSavedAt] = useState<string | null>(
    initial.draft?.savedAt ?? null,
  );
  const [saveOnThisTab, setSaveOnThisTab] = useState(Boolean(initial.draft));
  const draftId = useRef(initial.draft?.draftId ?? crypto.randomUUID());
  const commandId = useRef(initial.draft?.commandId ?? crypto.randomUUID());
  const lookup = useMutation({
    mutationFn: () => {
      const query = new URLSearchParams({ vin: fields.vin.trim().toUpperCase() });
      return request(`${sitePath(site.id)}/vehicles/lookup?${query}`, vehicleMatchSchema);
    },
    onSuccess: (match) => {
      setVehicleMatch(match);
      setSelectedVehicle(null);
      if (selectionReview.vehicle) setSelectionFallbackAllowed((current) => ({ ...current, vehicle: match === null }));
    },
  });
  const clientLookup = useMutation({
    mutationFn: () => {
      const query = new URLSearchParams({ q: fields.clientSearch.trim() });
      return request(`${sitePath(site.id)}/clients/lookup?${query}`, clientMatchSchema);
    },
    onSuccess: (matches) => {
      if (selectionReview.client) setSelectionFallbackAllowed((current) => ({ ...current, client: matches.length === 0 }));
    },
  });
  const ownerLookup = useMutation({
    mutationFn: () => {
      const query = new URLSearchParams({ q: fields.ownerSearch.trim() });
      return request(`${sitePath(site.id)}/parties/lookup?${query}`, partyMatchSchema);
    },
  });
  const contactLookup = useMutation({
    mutationFn: () => {
      const query = new URLSearchParams({ q: fields.visitContactSearch.trim() });
      return request(`${sitePath(site.id)}/parties/lookup?${query}`, partyMatchSchema);
    },
  });
  useEffect(() => {
    if (!online) return;
    let cancelled = false;
    const selectedClientId = selectionIds.client;
    if (selectedClientId && selectedClient?.id !== selectedClientId) {
      const query = new URLSearchParams({ q: fields.clientSearch.trim() });
      void request(`${sitePath(site.id)}/clients/lookup?${query}`, clientMatchSchema)
        .then((matches) => {
          if (cancelled) return;
          const match = matches.find((candidate) => candidate.id === selectedClientId);
          if (match) {
            setSelectedClient(match);
            setSelectionReview((current) => ({ ...current, client: false }));
          }
          else {
            setSelectionFallbackAllowed((current) => ({ ...current, client: matches.length === 0 }));
            setSelectionMessage("The saved client is no longer available at this service centre. Search for it again or choose to enter a new one.");
          }
        })
        .catch(() => { if (!cancelled) setSelectionMessage("The saved client could not be checked. Reconnect and check it before submitting this visit."); });
    }
    const selectedVehicleId = selectionIds.vehicle;
    if (selectedVehicleId && selectedVehicle?.id !== selectedVehicleId) {
      const query = new URLSearchParams({ vin: fields.vin.trim().toUpperCase() });
      void request(`${sitePath(site.id)}/vehicles/lookup?${query}`, vehicleMatchSchema)
        .then((match) => {
          if (cancelled) return;
          if (match?.id === selectedVehicleId) {
            setVehicleMatch(match);
            setSelectedVehicle(match);
            setSelectionReview((current) => ({ ...current, vehicle: false }));
          } else {
            setVehicleMatch(match);
            setSelectionFallbackAllowed((current) => ({ ...current, vehicle: match === null }));
            setSelectionMessage("The saved vehicle is no longer available at this service centre. Check the VIN or choose to enter a new vehicle.");
          }
        })
        .catch(() => { if (!cancelled) setSelectionMessage("The saved vehicle could not be checked. Reconnect and check it before submitting this visit."); });
    }
    return () => { cancelled = true; };
  }, [online, selectionIds.client, selectionIds.vehicle, selectedClient?.id, selectedVehicle?.id, fields.clientSearch, fields.vin, site.id]);
  function persistDraft(nextFields: IntakeFields, selectedClientId: string | null, selectedVehicleId: string | null, clientNeedsReview = selectionReview.client, vehicleNeedsReview = selectionReview.vehicle) {
    const now = new Date().toISOString();
    saveVisitDraft({
      draftId: draftId.current,
      commandId: commandId.current,
      fields: nextFields,
      selectedClientId,
      selectedVehicleId,
      clientSelectionNeedsReview: clientNeedsReview,
      vehicleSelectionNeedsReview: vehicleNeedsReview,
      savedAt: now,
    });
    setSavedAt(now);
    setStorageError(null);
  }
  function selectClient(match: z.infer<typeof clientMatchSchema>[number]) {
    selectionFocusId.current = "selected-client";
    setSelectionAnnouncement(`Selected paying client ${match.name}.`);
    setSelectionRevision((revision) => revision + 1);
    const nextFields = { ...fields, clientName: match.name, clientKind: match.kind, clientCode: match.clientCode };
    setSelectedClient(match);
    setSelectionIds((current) => ({ ...current, client: match.id }));
    setSelectionFallbackAllowed((current) => ({ ...current, client: false }));
    setSelectionReview((current) => ({ ...current, client: false }));
    setSelectionMessage(null);
    setFields(nextFields);
    if (saveOnThisTab) {
      try { persistDraft(nextFields, match.id, selectionIds.vehicle, false); }
      catch { setStorageError("This browser could not update the saved draft. Keep the page open and copy essential entries before leaving."); }
    }
  }
  function selectVehicle(match: NonNullable<z.infer<typeof vehicleMatchSchema>>) {
    selectionFocusId.current = "selected-vehicle";
    setSelectionAnnouncement(`Selected vehicle ${match.make} ${match.model}.`);
    setSelectionRevision((revision) => revision + 1);
    setSelectedVehicle(match);
    setSelectionIds((current) => ({ ...current, vehicle: match.id }));
    setSelectionFallbackAllowed((current) => ({ ...current, vehicle: false }));
    setSelectionReview((current) => ({ ...current, vehicle: false }));
    setSelectionMessage(null);
    if (saveOnThisTab) {
      try { persistDraft(fields, selectionIds.client, match.id, selectionReview.client, false); }
      catch { setStorageError("This browser could not update the saved draft. Keep the page open and copy essential entries before leaving."); }
    }
  }
  function useNewClient() {
    setSelectedClient(null);
    setSelectionIds((current) => ({ ...current, client: null }));
    setSelectionFallbackAllowed((current) => ({ ...current, client: false }));
    setSelectionReview((current) => ({ ...current, client: false }));
    setSelectionMessage(null);
    if (saveOnThisTab) {
      try { persistDraft(fields, null, selectionIds.vehicle, false); }
      catch { setStorageError("This browser could not update the saved draft. Keep the page open and copy essential entries before leaving."); }
    }
  }
  function useNewVehicle() {
    setSelectedVehicle(null);
    setVehicleMatch(null);
    setSelectionIds((current) => ({ ...current, vehicle: null }));
    setSelectionFallbackAllowed((current) => ({ ...current, vehicle: false }));
    setSelectionReview((current) => ({ ...current, vehicle: false }));
    setSelectionMessage(null);
    if (saveOnThisTab) {
      try { persistDraft(fields, selectionIds.client, null, selectionReview.client, false); }
      catch { setStorageError("This browser could not update the saved draft. Keep the page open and copy essential entries before leaving."); }
    }
  }
  const save = useMutation({
    mutationFn: () => {
      const intakeBody = {
          client: selectedClient
            ? { kind: "existing" as const, partyId: selectedClient.id }
            : { kind: "new" as const, partyKind: fields.clientKind, name: fields.clientName.trim(), clientCode: fields.clientCode.trim() || undefined, phone: fields.clientPhone.trim(), email: fields.clientEmail.trim() },
          owner: fields.ownerPartyId
            ? { kind: "existing" as const, partyId: fields.ownerPartyId }
            : { kind: "new" as const, partyKind: fields.ownerKind, name: fields.ownerName.trim(), phone: fields.ownerPhone.trim(), email: fields.ownerEmail.trim() },
          visitContact: fields.visitContactPartyId
            ? { kind: "existing" as const, partyId: fields.visitContactPartyId }
            : { kind: "new" as const, name: fields.visitContactName.trim(), phone: fields.phone.trim(), email: fields.email.trim() },
          vehicle: selectedVehicle
            ? { kind: "existing", vehicleId: selectedVehicle.id }
            : {
                kind: "new",
                vin: fields.vin.trim().toUpperCase(),
                registration: fields.registration.trim(),
                make: fields.make.trim(),
                model: fields.model.trim(),
                variant: fields.variant.trim(),
                powertrain: fields.powertrain.trim(),
              },
          odometerKm: Number(fields.odometerKm),
          socPercent:
            fields.socPercent === "" ? null : Number(fields.socPercent),
          powertrainClass: fields.powertrainClass,
          warrantyStatus: fields.warrantyStatus,
          warrantyConfirmationNote: fields.warrantyConfirmationNote.trim(),
          complaint: fields.complaint.trim(),
        };
      return request(source?`${sitePath(site.id)}/service-requests/${source.id}/reception`:`${sitePath(site.id)}/intake-drafts`, detailSchema, {
        method:"POST",commandId:commandId.current,body:source?{expectedVersion:source.version,reason:'Visit registered from request.',intake:intakeBody}:intakeBody,
      });
    },
    onSuccess: (order) => {
      try {
        removeVisitDraft();
      } catch {
        setStorageError(
          "The submitted draft could not be removed from tab storage. Close this tab on shared equipment.",
        );
      }
      client.setQueryData(["work-order", site.id, order.id], order);
      void client.invalidateQueries({ queryKey: ["work-orders", site.id] });
      notify(source ? "Request linked to a job; Operations review is next." : "Vehicle visit registered; Operations review is next.");
      navigate(`/sites/${site.id}/work-orders/${order.id}`);
    },
  });
  function updateMany(patch: Partial<IntakeFields>) {
    const names = Object.keys(patch);
    if (patch.clientSearch !== undefined) {
      clientLookup.reset();
      setSelectionFallbackAllowed((current) => ({ ...current, client: false }));
    }
    if (patch.ownerSearch !== undefined) ownerLookup.reset();
    if (patch.visitContactSearch !== undefined) contactLookup.reset();
    const clearsClient = names.some(name => ["clientName", "clientKind", "clientCode", "clientPhone", "clientEmail"].includes(name));
    if (clearsClient) setSelectedClient(null);
    if (names.some(name => ["ownerName", "ownerKind", "ownerPhone", "ownerEmail"].includes(name)) && !("ownerPartyId" in patch)) patch.ownerPartyId = "";
    if (names.some(name => ["visitContactName", "phone", "email"].includes(name)) && !("visitContactPartyId" in patch)) patch.visitContactPartyId = "";
    if (patch.vin !== undefined) {
      setVehicleMatch(null);
      setSelectedVehicle(null);
      lookup.reset();
    }
    const nextSelectionIds = {
      client: clearsClient ? null : selectionIds.client,
      vehicle: patch.vin !== undefined ? null : selectionIds.vehicle,
    };
    if (clearsClient || patch.vin !== undefined) {
      setSelectionIds(nextSelectionIds);
      setSelectionFallbackAllowed((current) => ({ ...current, ...(clearsClient ? { client: false } : {}), ...(patch.vin !== undefined ? { vehicle: false } : {}) }));
      setSelectionMessage(null);
    }
    const nextFields = { ...fields, ...patch };
    const nextCommandId = crypto.randomUUID();
    setFields(nextFields);
    commandId.current = nextCommandId;
    if (saveOnThisTab) {
      const now = new Date().toISOString();
      try {
        saveVisitDraft({
          draftId: draftId.current,
          commandId: nextCommandId,
          fields: nextFields,
          selectedClientId: nextSelectionIds.client,
          selectedVehicleId: nextSelectionIds.vehicle,
          clientSelectionNeedsReview: selectionReview.client,
          vehicleSelectionNeedsReview: selectionReview.vehicle,
          savedAt: now,
        });
        setSavedAt(now);
        setStorageError(null);
      } catch {
        setSavedAt(null);
        setStorageError(
          "This browser could not update the saved draft. Keep the page open and copy essential entries before leaving.",
        );
      }
    } else {
      setSavedAt(null);
    }
    save.reset();
  }
  function update(name: keyof IntakeFields, value: string) {
    updateMany({ [name]: value });
  }
  function selectParty(role: "owner" | "contact", party: z.infer<typeof partyMatchSchema>[number]) {
    if (role === "owner") {
      selectionFocusId.current = "selected-owner";
      setSelectionAnnouncement(`Selected reported vehicle owner ${party.name}.`);
      setSelectionRevision((revision) => revision + 1);
      updateMany({ ownerPartyId: party.id, ownerName: party.name, ownerKind: party.kind });
    } else {
      selectionFocusId.current = "selected-contact";
      setSelectionAnnouncement(`Selected visit contact ${party.name}.`);
      setSelectionRevision((revision) => revision + 1);
      updateMany({ visitContactPartyId: party.id, visitContactName: party.name });
    }
  }
  function saveInTab() {
    const now = new Date().toISOString();
    try {
      saveVisitDraft({
        draftId: draftId.current,
        commandId: commandId.current,
        fields,
        selectedClientId: selectionIds.client,
        selectedVehicleId: selectionIds.vehicle,
        clientSelectionNeedsReview: selectionReview.client,
        vehicleSelectionNeedsReview: selectionReview.vehicle,
        savedAt: now,
      });
      setSavedAt(now);
      setSaveOnThisTab(true);
      setStorageError(null);
    } catch {
      setStorageError(
        "This browser could not save the draft. Keep the page open and copy essential entries before leaving.",
      );
    }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if(source&&!confirmed)return;
    if (!fields.powertrainClass) return;
    if (selectionReview.client || (selectionIds.client && selectedClient?.id !== selectionIds.client)) {
      setSelectionMessage("Review the paying client before submitting this visit.");
      return;
    }
    if (selectionReview.vehicle || (selectionIds.vehicle && selectedVehicle?.id !== selectionIds.vehicle)) {
      setSelectionMessage("Review the vehicle before submitting this visit.");
      return;
    }
    save.mutate();
  }
  const input = (name: keyof IntakeFields) => ({
    value: fields[name],
    onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
      update(name, event.target.value),
  });
  const fieldError = (path: string) => {
    if (!(save.error instanceof ApiError)) return undefined;
    const messages = save.error.fields[path] ?? save.error.fields[`intake.${path}`];
    return messages ? (Array.isArray(messages) ? messages.join(" ") : messages) : undefined;
  };
  useEffect(() => {
    if (selectionAnnouncement && selectionFocusId.current) document.getElementById(selectionFocusId.current)?.focus();
  }, [selectionAnnouncement, selectionRevision]);
  if (!site.canWrite)
    return (
      <>
        <BackToQueue />
        <PageHeading eyebrow="Reception" title="Visit registration access required">
          Your site membership allows viewing work orders. Ask your site
          administrator for intake access.
        </PageHeading>
      </>
    );
  return (
    <>
      <BackToQueue />
      <PageHeading
        eyebrow="Reception"
        title={source ? "Confirm vehicle arrival and create job" : "Register a vehicle visit"}
        action={<Badge>Visit not yet registered</Badge>}
      >
        Record the paying client, reported vehicle owner, visit contact, vehicle and first concern. Saving creates one job for Operations review; it does not approve diagnosis or repair. Record the vehicle handover, condition photos and intake safety check.
      </PageHeading>
      {source&&<section className="panel mb-5 border-l-4 border-l-sky-600 p-5" aria-labelledby="request-arrival-title">
        <h2 id="request-arrival-title" className="text-lg font-semibold">From this customer request</h2>
        <p className="mt-1 text-sm text-zinc-600">These are reported details. Confirm the paying client, vehicle and visit contact below before creating one job.</p>
        <dl className="mt-4 grid min-w-0 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          <div className="min-w-0 sm:col-span-2"><dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Concern reported</dt><dd className="mt-1 break-words whitespace-pre-wrap">{source.request.concern}</dd></div>
          <div><dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Caller</dt><dd className="mt-1 break-words">{source.request.reportedContactName||'Not recorded'} · {requestRelationshipLabel[source.request.reportedContactRelationship]}</dd></div>
          <div><dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Caller phone</dt><dd className="mt-1 break-words">{source.request.reportedContactPhone||'Not recorded'}</dd></div>
          <div><dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Vehicle as reported</dt><dd className="mt-1 break-words">{source.request.reportedVehicle||'Not confirmed'}</dd></div>
          <div><dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Paying client as reported</dt><dd className="mt-1 break-words">{source.request.reportedClient||'Not confirmed'}</dd></div>
          <div><dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Request channel</dt><dd className="mt-1">{source.request.sourceChannel}</dd></div>
          <div><dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Next contact on request</dt><dd className="mt-1 break-words">{source.request.nextAction||'No next contact set'}{source.request.callbackDueAt?` · ${dateTime(source.request.callbackDueAt,site.timeZone)}`:''}</dd></div>
        </dl>
      </section>}
      <p className="sr-only" role="status" aria-live="polite">{selectionAnnouncement}</p>
      <div className="grid gap-6 xl:grid-cols-3">
        <form onSubmit={submit} className="space-y-6 xl:col-span-2">
          {source&&<label className="panel block p-4"><input type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)} required/> I confirmed the paying client, vehicle and visit match this request</label>}
          <fieldset disabled={save.isPending} className="panel min-w-0 p-5 sm:p-6">
            <legend className="float-left mb-2 w-full text-lg font-semibold text-zinc-900">Paying client</legend>
            <div className="clear-both grid gap-5 sm:grid-cols-2">
              <div className="sm:col-span-2 flex flex-wrap items-end gap-3">
                <div className="min-w-0 flex-1"><Field id="client-search" label="Find an existing paying client" hint="Search by client name or code; results are limited to this service centre." {...input("clientSearch")} /></div>
                <Button type="button" variant="secondary" onClick={()=>clientLookup.mutate()} disabled={!online||clientLookup.isPending||fields.clientSearch.trim().length<2}>{clientLookup.isPending?"Searching…":"Search paying clients"}</Button>
              </div>
              <FormError error={clientLookup.error} />
              {clientLookup.data && clientLookup.data.length > 0 && !selectedClient && <div className="sm:col-span-2 space-y-2">{clientLookup.data.map(match=><button type="button" key={match.id} onClick={()=>selectClient(match)} className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-white px-4 py-2 text-left hover:border-blue-300"><span className="min-w-0"><span className="block truncate text-sm font-semibold">{match.name}</span><span className="block font-mono text-xs text-zinc-500">{match.clientCode} · {match.kind}</span></span><span className="text-xs font-semibold text-blue-800">Select</span></button>)}</div>}
              {clientLookup.data?.length===0&&<p role="status" className="sm:col-span-2 text-sm text-zinc-600">No existing client matched. Register a new paying client below.</p>}
              {selectedClient&&<div id="selected-client" tabIndex={-1} className="sm:col-span-2 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50/60 p-4"><p className="text-sm"><span className="font-semibold">Selected client:</span> {selectedClient.name} <span className="font-mono text-xs">({selectedClient.clientCode})</span></p><Button type="button" variant="secondary" onClick={useNewClient}>Use a new client</Button></div>}
              {(selectionReview.client||(selectionIds.client&&!selectedClient))&&<div role="alert" className="sm:col-span-2 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm"><p>{selectionReview.client?"This older draft cannot confirm whether the paying client is new or already saved. Search and select an existing client, or confirm these details as a new client.":online?"Checking the saved client at this service centre. Submission stays blocked until it is confirmed.":"Reconnect to check the saved client before submitting this visit."}</p><Button type="button" variant="secondary" className="mt-3" disabled={!online||!selectionFallbackAllowed.client} onClick={useNewClient}>{selectionReview.client?"Use these details as a new client":"Enter a new client instead"}</Button></div>}
              <div><label htmlFor="client-kind">Client type</label><select id="client-kind" aria-invalid={fieldError("client.partyKind") ? true : undefined} aria-describedby={fieldError("client.partyKind") ? "client-kind-error" : undefined} disabled={Boolean(selectedClient)} value={fields.clientKind} onChange={event => update("clientKind",event.target.value as IntakeFields["clientKind"])}><option value="organisation">Organisation</option><option value="person">Person</option></select>{fieldError("client.partyKind")&&<p id="client-kind-error" className="mt-1 text-sm font-normal text-red-800">{fieldError("client.partyKind")}</p>}</div>
              <Field id="client-name" label="Paying client name" error={fieldError("client.name")} required disabled={Boolean(selectedClient)} maxLength={160} autoComplete="organization" {...input("clientName")} />
              <Field id="client-code" label="Client code (optional)" error={fieldError("client.clientCode")} disabled={Boolean(selectedClient)} maxLength={20} autoCapitalize="characters" hint="Leave blank for a system-issued code. Use SR for a showroom when available." {...input("clientCode")} />
              <Field id="client-phone" label="Paying client phone" error={fieldError("client.phone")} type="tel" disabled={Boolean(selectedClient)} maxLength={50} hint="Optional" {...input("clientPhone")} />
              <Field id="client-email" label="Paying client email" error={fieldError("client.email")} type="email" disabled={Boolean(selectedClient)} maxLength={254} hint="Optional" {...input("clientEmail")} />
              <p className="sm:col-span-2 text-xs leading-5 text-zinc-500">The paying client is responsible for the bill, such as a showroom. Record any showroom payment guarantee separately.</p>
            </div>
          </fieldset>
          <fieldset disabled={save.isPending} className="panel min-w-0 p-5 sm:p-6">
            <legend className="float-left mb-2 w-full text-lg font-semibold text-zinc-900">Vehicle owner (as reported)</legend>
            <div className="clear-both grid gap-5 sm:grid-cols-2">
              <div className="sm:col-span-2 flex flex-wrap items-end gap-3">
                <div className="min-w-0 flex-1"><Field id="owner-search" label="Find a previous vehicle owner" hint="Only people and organisations already saved at this service centre are shown." {...input("ownerSearch")} /></div>
                <Button type="button" variant="secondary" onClick={()=>ownerLookup.mutate()} disabled={!online||ownerLookup.isPending||fields.ownerSearch.trim().length<2}>{ownerLookup.isPending?"Searching…":"Search owners"}</Button>
              </div>
              <FormError error={ownerLookup.error} />
              {ownerLookup.data && ownerLookup.data.length > 0 && !fields.ownerPartyId && <div className="sm:col-span-2 space-y-2">{ownerLookup.data.map(match=><button type="button" key={match.id} onClick={()=>selectParty("owner",match)} className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-white px-4 py-2 text-left hover:border-blue-300"><span className="min-w-0"><span className="block truncate text-sm font-semibold">{match.name}</span><span className="block text-xs text-zinc-500">{match.kind}</span></span><span className="text-xs font-semibold text-blue-800">Select</span></button>)}</div>}
              {ownerLookup.isSuccess&&ownerLookup.data.length===0&&<p role="status" className="sm:col-span-2 text-sm text-zinc-600">No saved vehicle owner matched. Enter a new reported owner below.</p>}
              {fields.ownerPartyId&&<div id="selected-owner" tabIndex={-1} className="sm:col-span-2 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50/60 p-4"><p className="text-sm"><span className="font-semibold">Selected vehicle owner (as reported):</span> {fields.ownerName} <span className="text-xs text-zinc-600">({fields.ownerKind})</span></p><Button type="button" variant="secondary" onClick={()=>updateMany({ownerPartyId:"",ownerName:"",ownerPhone:"",ownerEmail:""})}>Enter another owner</Button></div>}
              <div><label htmlFor="owner-kind">Owner type</label><select id="owner-kind" aria-invalid={fieldError("owner.partyKind") ? true : undefined} aria-describedby={fieldError("owner.partyKind") ? "owner-kind-error" : undefined} disabled={Boolean(fields.ownerPartyId)} value={fields.ownerKind} onChange={event => update("ownerKind",event.target.value as IntakeFields["ownerKind"])}><option value="person">Person</option><option value="organisation">Organisation</option></select>{fieldError("owner.partyKind")&&<p id="owner-kind-error" className="mt-1 text-sm font-normal text-red-800">{fieldError("owner.partyKind")}</p>}</div>
              <Field id="owner-name" label="Vehicle owner name" error={fieldError("owner.name")} required disabled={Boolean(fields.ownerPartyId)} maxLength={160} autoComplete="name" {...input("ownerName")} />
              <Field id="owner-phone" label="Owner phone" error={fieldError("owner.phone")} type="tel" disabled={Boolean(fields.ownerPartyId)} maxLength={50} hint="Optional" {...input("ownerPhone")} />
              <Field id="owner-email" label="Owner email" error={fieldError("owner.email")} type="email" disabled={Boolean(fields.ownerPartyId)} maxLength={254} hint="Optional" {...input("ownerEmail")} />
              <p className="sm:col-span-2 text-xs leading-5 text-zinc-500">This records who is reported as the owner. It does not verify ownership or grant customer-portal access.</p>
            </div>
          </fieldset>
          <fieldset disabled={save.isPending} className="panel min-w-0 p-5 sm:p-6">
            <legend className="float-left mb-2 w-full text-lg font-semibold text-zinc-900">Visit contact</legend>
            <div className="clear-both grid gap-5 sm:grid-cols-2">
              <div className="sm:col-span-2 flex flex-wrap items-end gap-3">
                <div className="min-w-0 flex-1"><Field id="contact-search" label="Find a previous visit contact" hint="Only people already recorded at this service centre can be selected." {...input("visitContactSearch")} /></div>
                <Button type="button" variant="secondary" onClick={()=>contactLookup.mutate()} disabled={!online||contactLookup.isPending||fields.visitContactSearch.trim().length<2}>{contactLookup.isPending?"Searching…":"Search contacts"}</Button>
              </div>
              <FormError error={contactLookup.error} />
              {contactLookup.data && contactLookup.data.filter(match=>match.kind==="person").length > 0 && !fields.visitContactPartyId && <div className="sm:col-span-2 space-y-2">{contactLookup.data.filter(match=>match.kind==="person").map(match=><button type="button" key={match.id} onClick={()=>selectParty("contact",match)} className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-white px-4 py-2 text-left hover:border-blue-300"><span className="min-w-0"><span className="block truncate text-sm font-semibold">{match.name}</span><span className="block text-xs text-zinc-500">Person</span></span><span className="text-xs font-semibold text-blue-800">Select</span></button>)}</div>}
              {contactLookup.isSuccess&&contactLookup.data.filter(match=>match.kind==="person").length===0&&<p role="status" className="sm:col-span-2 text-sm text-zinc-600">No saved visit contact matched. Enter a new visit contact below.</p>}
              {fields.visitContactPartyId&&<div id="selected-contact" tabIndex={-1} className="sm:col-span-2 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50/60 p-4"><p className="text-sm"><span className="font-semibold">Selected visit contact:</span> {fields.visitContactName}</p><Button type="button" variant="secondary" onClick={()=>updateMany({visitContactPartyId:"",visitContactName:"",phone:"",email:""})}>Enter new contact</Button></div>}
              <Field id="contact-name" label="Visit contact name" error={fieldError("visitContact.name")} required disabled={Boolean(fields.visitContactPartyId)} maxLength={160} autoComplete="name" {...input("visitContactName")} />
              <Field id="contact-phone" label="Phone number" error={fieldError("visitContact.phone")} type="tel" required disabled={Boolean(fields.visitContactPartyId)} maxLength={50} autoComplete="tel" {...input("phone")} />
              <Field id="contact-email" label="Contact email" error={fieldError("visitContact.email")} type="email" disabled={Boolean(fields.visitContactPartyId)} maxLength={254} autoComplete="email" hint="Optional" {...input("email")} />
            </div>
          </fieldset>
          <fieldset
            disabled={save.isPending}
            className="panel min-w-0 p-5 sm:p-6"
          >
            <legend className="float-left mb-6 w-full text-lg font-semibold text-zinc-900">
              Vehicle
            </legend>
            <div className="clear-both grid gap-5 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Field
                  id="vehicle-vin"
                  label="Vehicle identification number (VIN)"
                  error={fieldError("vehicle.vin")}
                  required
                  maxLength={17}
                  minLength={17}
                  pattern="[A-HJ-NPR-Za-hj-npr-z0-9]{17}"
                  autoCapitalize="characters"
                  spellCheck={false}
                  className="font-mono uppercase tabular-nums"
                  hint="17 characters. VINs do not use I, O or Q."
                  {...input("vin")}
                />
              </div>
              <div className="sm:col-span-2">
                <VinScanner onScan={(vin) => update("vin", vin)} disabled={save.isPending} />
              </div>
              <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => lookup.mutate()}
                  disabled={lookup.isPending || !online || !/^[A-HJ-NPR-Z0-9]{17}$/i.test(fields.vin.trim())}
                >
                  {lookup.isPending ? "Searching this site…" : "Find vehicle at this site"}
                </Button>
                <span className="text-xs text-zinc-500">Search is limited to this service centre.</span>
              </div>
              {vehicleMatch && !selectedVehicle && (
                <div className="sm:col-span-2 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50/60 p-4">
                  <div>
                    <p className="text-sm font-semibold text-zinc-900">{vehicleMatch.make} {vehicleMatch.model}{vehicleMatch.variant ? ` · ${vehicleMatch.variant}` : ""}</p>
                    <p className="mt-1 font-mono text-xs text-zinc-600">{vehicleMatch.vin} · {vehicleMatch.registration || "Registration not recorded"}</p>
                    {vehicleMatch.powertrain && <p className="mt-1 text-xs text-zinc-600">{vehicleMatch.powertrain}</p>}
                  </div>
                  <Button type="button" variant="secondary" onClick={() => selectVehicle(vehicleMatch)}>
                    Use this vehicle
                  </Button>
                </div>
              )}
              {vehicleMatch === null && lookup.isSuccess && !selectedVehicle && (
                <p role="status" className="sm:col-span-2 text-sm text-zinc-600">No vehicle with this VIN is recorded at this site. Enter its details below to create a new vehicle record.</p>
              )}
              {selectedVehicle && (
                <div id="selected-vehicle" tabIndex={-1} className="sm:col-span-2 rounded-lg border border-emerald-200 bg-emerald-50/50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">Existing vehicle selected</p>
                  <p className="mt-2 text-sm font-semibold">{selectedVehicle.make} {selectedVehicle.model}{selectedVehicle.variant ? ` · ${selectedVehicle.variant}` : ""}</p>
                  <p className="mt-1 font-mono text-xs text-zinc-600">{selectedVehicle.vin} · {selectedVehicle.registration || "Registration not recorded"}</p>
                  {selectedVehicle.powertrain && <p className="mt-1 text-xs text-zinc-600">{selectedVehicle.powertrain}</p>}
              <p className="mt-2 text-xs text-zinc-600">This visit records a new reported owner for this work order; it does not change verified owner access.</p>
                </div>
              )}
              {(selectionReview.vehicle||(selectionIds.vehicle&&!selectedVehicle))&&<div role="alert" className="sm:col-span-2 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm"><p>{selectionReview.vehicle?"This older draft cannot confirm whether the vehicle is new or already saved. Search and select the existing vehicle, or confirm this as a new vehicle.":online?"Checking the saved vehicle at this service centre. Submission stays blocked until it is confirmed.":"Reconnect to check the saved vehicle before submitting this visit."}</p><Button type="button" variant="secondary" className="mt-3" disabled={!online||!selectionFallbackAllowed.vehicle} onClick={useNewVehicle}>{selectionReview.vehicle?"Enter a new vehicle":"Enter a new vehicle instead"}</Button></div>}
              <div className={selectedVehicle ? "hidden" : "contents"}>
              <Field
                id="vehicle-registration"
                label="Registration number"
                  error={fieldError("vehicle.registration")}
                required
                disabled={Boolean(selectedVehicle)}
                maxLength={32}
                autoCapitalize="characters"
                {...input("registration")}
              />
              <Field
                id="vehicle-make"
                label="Make"
                  error={fieldError("vehicle.make")}
                required
                disabled={Boolean(selectedVehicle)}
                maxLength={100}
                {...input("make")}
              />
              <Field
                id="vehicle-model"
                label="Model"
                  error={fieldError("vehicle.model")}
                required
                disabled={Boolean(selectedVehicle)}
                maxLength={100}
                {...input("model")}
              />
              <Field
                id="vehicle-variant"
                label="Variant"
                  error={fieldError("vehicle.variant")}
                maxLength={160}
                hint="Optional; leave blank if not confirmed."
                disabled={Boolean(selectedVehicle)}
                {...input("variant")}
              />
              <Field
                id="vehicle-powertrain"
                label="Engine or motor"
                  error={fieldError("vehicle.powertrain")}
                maxLength={160}
                hint="Optional. For example: 2.0L petrol, diesel, hybrid or electric."
                disabled={Boolean(selectedVehicle)}
                {...input("powertrain")}
              />
              </div>
              <Field
                id="odometer"
                label="Odometer reading in kilometres"
                error={fieldError("odometerKm")}
                type="number"
                min={0}
                max={10_000_000}
                step={1}
                required
                inputMode="numeric"
                {...input("odometerKm")}
              />
              <Field
                id="state-of-charge"
                label="Battery charge (%)"
                error={fieldError("socPercent")}
                type="number"
                min={0}
                max={100}
                step={1}
                inputMode="numeric"
                hint="Leave blank if not known or not applicable."
                {...input("socPercent")}
              />
              <div className="sm:col-span-2">
                <label htmlFor="booking-powertrain-class">Vehicle type for booking number</label>
                <select id="booking-powertrain-class" aria-invalid={fieldError("powertrainClass") ? true : undefined} aria-describedby={fieldError("powertrainClass") ? "booking-powertrain-class-error" : undefined} required value={fields.powertrainClass} onChange={event=>update("powertrainClass",event.target.value as IntakeFields["powertrainClass"])}>
                  <option value="">Choose vehicle type</option>
                  <option value="EV">Electric (EV)</option>
                  <option value="HYB">Hybrid (HYB)</option>
                  <option value="ICE">Combustion engine (ICE)</option>
                </select>
                {fieldError("powertrainClass")&&<p id="booking-powertrain-class-error" className="mt-1 text-sm font-normal text-red-800">{fieldError("powertrainClass")}</p>}
                <p className="mt-1 text-xs leading-5 text-zinc-500">This choice appears in the booking number. Operations assigns hybrid jobs to a qualified team lead.</p>
              </div>
              <div><label htmlFor="warranty-status">Warranty at booking</label><select id="warranty-status" aria-invalid={fieldError("warrantyStatus") ? true : undefined} aria-describedby={fieldError("warrantyStatus") ? "warranty-status-error" : undefined} value={fields.warrantyStatus} onChange={event=>update("warrantyStatus",event.target.value as IntakeFields["warrantyStatus"])}><option value="unknown">Not yet known</option><option value="not-confirmed">Not confirmed</option><option value="confirmed">Confirmed</option></select>{fieldError("warrantyStatus")&&<p id="warranty-status-error" className="mt-1 text-sm font-normal text-red-800">{fieldError("warrantyStatus")}</p>}</div>
              {fields.warrantyStatus==="confirmed"&&<div className="sm:col-span-2"><label htmlFor="warranty-confirmation">Confirmation basis</label><textarea id="warranty-confirmation" aria-invalid={fieldError("warrantyConfirmationNote") ? true : undefined} aria-describedby={fieldError("warrantyConfirmationNote") ? "warranty-confirmation-error" : undefined} value={fields.warrantyConfirmationNote} onChange={event=>update("warrantyConfirmationNote",event.target.value)} required maxLength={500} rows={2} placeholder="Record the source checked and confirmation details." />{fieldError("warrantyConfirmationNote")&&<p id="warranty-confirmation-error" className="mt-1 text-sm font-normal text-red-800">{fieldError("warrantyConfirmationNote")}</p>}</div>}
            </div>
          </fieldset>
          <fieldset
            disabled={save.isPending}
            className="panel min-w-0 p-5 sm:p-6"
          >
            <legend className="float-left mb-2 w-full text-lg font-semibold text-zinc-900">
              First reported concern
            </legend>
            <div className="clear-both">
              <p className="mb-5 text-sm text-zinc-500">
                Use the customer's own words. Add each later concern on a
                separate line.
              </p>
              <label htmlFor="customer-concern">What needs attention?</label>
              <textarea
                id="customer-concern"
                aria-invalid={fieldError("complaint") ? true : undefined}
                aria-describedby={fieldError("complaint") ? "customer-concern-error" : undefined}
                value={fields.complaint}
                onChange={(event) => update("complaint", event.target.value)}
                required
                maxLength={4000}
                rows={4}
                placeholder="Describe the symptom, when it occurs and what the customer noticed."
              />
              {fieldError("complaint")&&<p id="customer-concern-error" className="mt-1 text-sm font-normal text-red-800">{fieldError("complaint")}</p>}
            </div>
          </fieldset>
          <FormError error={save.error} />
          <FormError error={selectionMessage ? new Error(selectionMessage) : null} />
          <FormError error={lookup.error} />
          {storageError && (
            <div role="alert" className="error-box">
              {storageError}
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button
              type="button"
              variant="secondary"
              onClick={saveInTab}
              disabled={save.isPending}
            >
              <Save className="size-4" aria-hidden="true" />
              Save in this tab
            </Button>
            <Button type="submit" disabled={save.isPending || !online}>
              {save.isPending ? "Registering visit…" : "Register visit for Operations review"}
              <ArrowRight className="size-4" aria-hidden="true" />
            </Button>
          </div>
          <p role="status" className="text-xs leading-5 text-zinc-500">
            {savedAt
              ? `Saved in this tab at ${dateTime(savedAt, site.timeZone)}. Later edits save here automatically; this is still unsubmitted.`
              : "Entries stay on this page. Choose Save in this tab to recover them after a refresh."}{" "}
            Signing out or switching site clears tab drafts.
          </p>
        </form>
        <aside className="space-y-5">
          <div className="panel p-5 sm:p-6">
            <div className="mb-4 flex size-10 items-center justify-center rounded-lg bg-zinc-100">
              <ClipboardList
                className="size-5 text-zinc-600"
                aria-hidden="true"
              />
            </div>
            <h2 className="section-title">One visit, one work order</h2>
            <p className="mt-3 text-sm leading-6 text-zinc-500">
              The server assigns a powertrain, client and sequence booking reference, then C01 for this concern. Add further concerns to that same work order.
            </p>
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 sm:p-6">
            <ShieldAlert
              className="mb-3 size-5 text-amber-700"
              aria-hidden="true"
            />
            <h2 className="text-sm font-semibold text-amber-950">
              Reception evidence is still needed
            </h2>
            <p className="mt-3 text-sm leading-6 text-amber-900">
              Custody, vehicle condition photographs and safety triage must be
              recorded before G1 can be accepted. A draft does not authorise
              diagnostic or repair work.
            </p>
          </div>
          <p className="px-1 text-xs leading-5 text-zinc-500">
            Tab storage is temporary and may be cleared by your browser. The
            server holds the record only after a successful submission.
          </p>
        </aside>
      </div>
    </>
  );
}
