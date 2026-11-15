import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { z } from 'zod';
import {
  ApiError,
  financeConfigurationDraftContentSchema,
  financeConfigurationDraftListSchema,
  financeConfigurationDraftSaveSchema,
  request,
  sitePath,
} from '../api';
import type { FinanceConfigurationDraftContent, FinanceConfigurationDraftItem } from '../api';
import { Button, Empty, Failure, Loading, PageHeading, dateTime, useOnline, useToast } from '../ui';
import { useStaff } from '../workspace';

const emptyContent = (): FinanceConfigurationDraftContent => financeConfigurationDraftContentSchema.parse({
  schemaVersion: 1,
  legalEntity: { proposedName: null, registrationReference: null, businessAddress: null, businessContactReference: null },
  currencyCode: null,
  rateScheduleReference: null,
  taxTreatmentReference: null,
  invoiceNumberingRuleReference: null,
  receiptNumberingRuleReference: null,
  paymentTermsReference: null,
  paymentVerificationSourceReference: null,
  paymentEvidencePolicyReference: null,
  showroomGuaranteeAuthorityReference: null,
  invoiceTemplateReference: null,
  receiptTemplateReference: null,
  emailSenderConfigurationReference: null,
  verifiedClientEmailPolicyReference: null,
  correctionPolicyReference: null,
  retentionPolicyReference: null,
  sourceReferences: [],
});

type Editor = { draftId: string; expectedRevision: number };
type ReferenceField = Exclude<keyof FinanceConfigurationDraftContent,
  'schemaVersion' | 'legalEntity' | 'currencyCode' | 'sourceReferences'>;

export function FinanceSetup() {
  const { site } = useStaff();
  const online = useOnline();
  const toast = useToast();
  const queryClient = useQueryClient();
  const attempt = useRef<{ payload: string; commandId: string } | null>(null);
  const [page, setPage] = useState(1);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [preview, setPreview] = useState<FinanceConfigurationDraftItem | null>(null);
  const [content, setContent] = useState<FinanceConfigurationDraftContent>(emptyContent);
  const [revisionNote, setRevisionNote] = useState('');
  const [message, setMessage] = useState('');

  const list = useQuery({
    queryKey: ['finance-configuration-drafts', site.id, page],
    queryFn: () => request(
      `${sitePath(site.id)}/finance/configuration-drafts?page=${page}&pageSize=25`,
      financeConfigurationDraftListSchema,
    ),
    enabled: online,
    retry: false,
  });

  const save = useMutation({
    mutationFn: (input: { editor: Editor; content: FinanceConfigurationDraftContent; revisionNote: string }) => {
      const body = { ...input.editor, revisionNote: input.revisionNote, content: input.content };
      const payload = JSON.stringify(body);
      if (!attempt.current || attempt.current.payload !== payload)
        attempt.current = { payload, commandId: crypto.randomUUID() };
      return request(`${sitePath(site.id)}/finance/configuration-drafts`, financeConfigurationDraftSaveSchema, {
        method: 'POST', commandId: attempt.current.commandId, body,
      });
    },
    onSuccess: async result => {
      attempt.current = null;
      setEditor(null);
      setRevisionNote('');
      setMessage('');
      setPage(1);
      toast(`Proposal revision ${result.revision} saved. It is not approved or in use.`);
      await queryClient.invalidateQueries({ queryKey: ['finance-configuration-drafts', site.id] });
    },
    onError: async error => {
      if (error instanceof ApiError && error.status === 409) {
        attempt.current = null;
        setMessage('This proposal changed after you opened it. Reload the list and open its latest revision before saving again.');
      } else if (error instanceof ApiError && error.status === 403) {
        setMessage('Your Finance setup access has changed. Ask the person responsible for Finance access to review your approved access.');
      } else {
        setMessage(error instanceof Error ? error.message : 'The proposal could not be saved.');
      }
      await queryClient.invalidateQueries({ queryKey: ['finance-configuration-drafts', site.id] });
    },
  });

  const grantRequired = list.error instanceof ApiError
    && list.error.code === 'FINANCE_CONFIGURATION_GRANT_REQUIRED';

  function startNew() {
    setEditor({ draftId: crypto.randomUUID(), expectedRevision: 0 });
    setPreview(null);
    setContent(emptyContent());
    setRevisionNote('');
    setMessage('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function openCurrent(item: FinanceConfigurationDraftItem) {
    setEditor({ draftId: item.draftId, expectedRevision: item.revision });
    setPreview(null);
    setContent(item.content);
    setRevisionNote('');
    setMessage('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function openReadOnly(item: FinanceConfigurationDraftItem) {
    setEditor(null);
    setPreview(item);
    setMessage('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function updateReference(field: ReferenceField, value: string) {
    setContent(current => ({ ...current, [field]: value.length ? value : null }));
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor || !list.data?.canManage || !online || save.isPending) return;
    const parsed = financeConfigurationDraftContentSchema.safeParse(content);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      setMessage(issue ? `Check ${issue.path.join(' → ')}: ${issue.message}` : 'Check the proposal fields and try again.');
      return;
    }
    const note = z.string().trim().min(1).max(500).safeParse(revisionNote);
    if (!note.success) {
      setMessage('Add a short reason for saving this proposal revision.');
      return;
    }
    setMessage('');
    save.mutate({ editor, content: parsed.data, revisionNote: note.data });
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <PageHeading eyebrow="Finance · proposals only" title="Finance setup">
        Record Finance setup for review. Nothing saved here approves or activates rates, terms, invoices, payments, receipts, email, or vehicle release.
      </PageHeading>

      <section className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm leading-6 text-amber-950" role="note">
        <strong>Proposal only — not approved or in use.</strong> Do not enter passwords, API keys, email credentials, customer details, or payment evidence. Use document or policy references.
      </section>

      {editor && (
        <ProposalForm
          content={content}
          editor={editor}
          isSaving={save.isPending}
          message={message}
          revisionNote={revisionNote}
          setContent={setContent}
          setRevisionNote={setRevisionNote}
          updateReference={updateReference}
          cancel={() => { setEditor(null); setMessage(''); }}
          submit={submit}
        />
      )}

      {preview && <ProposalPreview item={preview} timeZone={site.timeZone} close={() => setPreview(null)} />}

      <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm" aria-labelledby="finance-proposals-heading">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="finance-proposals-heading" className="text-xl font-semibold text-zinc-950">Finance proposals</h2>
            <p className="mt-1 text-sm text-zinc-600">Proposals and earlier revisions for this site. They have no effect on Finance operations.</p>
          </div>
          {list.data?.canManage && <Button onClick={startNew}>New proposal</Button>}
        </div>

        {!online && !list.data && <p className="mt-5 rounded-md bg-zinc-100 p-4 text-sm text-zinc-700">Connect to the internet to load Finance proposals.</p>}
        {online && list.isLoading && <Loading label="Loading Finance proposals" />}
        {grantRequired && <p className="mt-5 rounded-md border border-zinc-200 bg-zinc-50 p-4 text-sm leading-6 text-zinc-700">Finance setup access has not been assigned to this account. A current site access grant is required to view or edit proposals.</p>}
        {list.isError && !grantRequired && <div className="mt-4"><Failure error={list.error} retry={() => void list.refetch()} /></div>}
        {list.data && list.data.items.length === 0 && <Empty title="No Finance proposals yet">A staff member with Finance setup edit access can record a proposal for review.</Empty>}
        {list.data && list.data.items.length > 0 && (
          <>
            <ol className="mt-4 divide-y divide-zinc-200" aria-label="Finance proposal revisions">
              {list.data.items.map(item => (
                <li key={item.revisionId} className="flex flex-wrap items-center justify-between gap-4 py-4">
                  <div className="min-w-0">
                    <h3 className="font-semibold text-zinc-900">Proposal {item.draftId.slice(0, 8)} · revision {item.revision}</h3>
                    <p className="mt-1 break-words text-sm text-zinc-700">{item.content.legalEntity.proposedName ?? 'Business name not provided'} · {item.content.currencyCode ?? 'Currency not provided'}</p>
                    <p className="mt-1 text-xs text-zinc-600">{item.isCurrent ? 'Current revision' : 'Earlier revision'} · {dateTime(item.createdAt, site.timeZone)}</p>
                    <p className="mt-1 text-xs text-zinc-600">Reason: {item.revisionNote}</p>
                    <p className="mt-1 text-xs font-medium text-amber-800">Not approved or in use</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" onClick={() => openReadOnly(item)}>View revision</Button>
                    {list.data.canManage && item.isCurrent && <Button onClick={() => openCurrent(item)}>Create new revision</Button>}
                  </div>
                </li>
              ))}
            </ol>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200 pt-4">
              <p className="text-sm text-zinc-600">Page {list.data.page} of {Math.max(1, list.data.totalPages)} · {list.data.totalItems} revisions</p>
              <div className="flex gap-2">
                <Button variant="secondary" disabled={page <= 1 || list.isFetching} onClick={() => setPage(value => Math.max(1, value - 1))}>Previous page</Button>
                <Button variant="secondary" disabled={page >= list.data.totalPages || list.isFetching} onClick={() => setPage(value => value + 1)}>Next page</Button>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function ProposalForm({
  content, editor, isSaving, message, revisionNote, setContent, setRevisionNote, updateReference, cancel, submit,
}: {
  content: FinanceConfigurationDraftContent;
  editor: Editor;
  isSaving: boolean;
  message: string;
  revisionNote: string;
  setContent: React.Dispatch<React.SetStateAction<FinanceConfigurationDraftContent>>;
  setRevisionNote: (value: string) => void;
  updateReference: (field: ReferenceField, value: string) => void;
  cancel: () => void;
  submit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  const currentRevision = editor.expectedRevision;
  return (
    <form className="space-y-5 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm" onSubmit={submit} aria-labelledby="finance-proposal-form-heading">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-blue-800">Non-effective draft</p>
        <h2 id="finance-proposal-form-heading" className="mt-1 text-xl font-semibold text-zinc-950">{currentRevision === 0 ? 'New Finance proposal' : `New revision of proposal ${currentRevision}`}</h2>
        <p className="mt-1 text-sm text-zinc-600">Enter approved document references where known. Leave unresolved items blank for later review.</p>
      </div>

      <fieldset className="grid gap-4 rounded-lg border border-zinc-200 p-4 sm:grid-cols-2">
        <legend className="px-2 font-semibold text-zinc-900">Business identity</legend>
        <TextField label="Proposed business name" value={content.legalEntity.proposedName ?? ''} onChange={value => setContent(current => ({ ...current, legalEntity: { ...current.legalEntity, proposedName: value || null } }))} />
        <TextField label="Registration reference" value={content.legalEntity.registrationReference ?? ''} onChange={value => setContent(current => ({ ...current, legalEntity: { ...current.legalEntity, registrationReference: value || null } }))} />
        <TextAreaField label="Proposed business address" value={content.legalEntity.businessAddress ?? ''} onChange={value => setContent(current => ({ ...current, legalEntity: { ...current.legalEntity, businessAddress: value || null } }))} />
        <TextField label="Business contact reference" help="Use a record or contact reference, not a password or secret." value={content.legalEntity.businessContactReference ?? ''} onChange={value => setContent(current => ({ ...current, legalEntity: { ...current.legalEntity, businessContactReference: value || null } }))} />
      </fieldset>

      <fieldset className="grid gap-4 rounded-lg border border-zinc-200 p-4 sm:grid-cols-2">
        <legend className="px-2 font-semibold text-zinc-900">Currency and pricing</legend>
        <TextField label="Proposed currency code" help="Three uppercase letters, such as GHS. This does not activate a currency." value={content.currencyCode ?? ''} maxLength={3} onChange={value => setContent(current => ({ ...current, currencyCode: value ? value.toUpperCase() : null }))} />
        <ReferenceField label="Rate schedule reference" value={content.rateScheduleReference} onChange={value => updateReference('rateScheduleReference', value)} />
        <ReferenceField label="Tax treatment reference" value={content.taxTreatmentReference} onChange={value => updateReference('taxTreatmentReference', value)} />
        <ReferenceField label="Payment terms reference" value={content.paymentTermsReference} onChange={value => updateReference('paymentTermsReference', value)} />
      </fieldset>

      <fieldset className="grid gap-4 rounded-lg border border-zinc-200 p-4 sm:grid-cols-2">
        <legend className="px-2 font-semibold text-zinc-900">Invoices and receipts</legend>
        <ReferenceField label="Invoice numbering rule" value={content.invoiceNumberingRuleReference} onChange={value => updateReference('invoiceNumberingRuleReference', value)} />
        <ReferenceField label="Receipt numbering rule" value={content.receiptNumberingRuleReference} onChange={value => updateReference('receiptNumberingRuleReference', value)} />
        <ReferenceField label="Invoice template" value={content.invoiceTemplateReference} onChange={value => updateReference('invoiceTemplateReference', value)} />
        <ReferenceField label="Receipt template" value={content.receiptTemplateReference} onChange={value => updateReference('receiptTemplateReference', value)} />
        <ReferenceField label="Correction policy reference" value={content.correctionPolicyReference} onChange={value => updateReference('correctionPolicyReference', value)} />
      </fieldset>

      <fieldset className="grid gap-4 rounded-lg border border-zinc-200 p-4 sm:grid-cols-2">
        <legend className="px-2 font-semibold text-zinc-900">Payment checks and showroom guarantees</legend>
        <ReferenceField label="Payment confirmation source" value={content.paymentVerificationSourceReference} onChange={value => updateReference('paymentVerificationSourceReference', value)} />
        <ReferenceField label="Payment evidence policy" value={content.paymentEvidencePolicyReference} onChange={value => updateReference('paymentEvidencePolicyReference', value)} />
        <ReferenceField label="Showroom guarantee authority" value={content.showroomGuaranteeAuthorityReference} onChange={value => updateReference('showroomGuaranteeAuthorityReference', value)} />
      </fieldset>

      <fieldset className="grid gap-4 rounded-lg border border-zinc-200 p-4 sm:grid-cols-2">
        <legend className="px-2 font-semibold text-zinc-900">Client documents and email</legend>
        <ReferenceField label="Email sender setup reference" help="Store sender credentials in the managed secret store, never here." value={content.emailSenderConfigurationReference} onChange={value => updateReference('emailSenderConfigurationReference', value)} />
        <ReferenceField label="Verified client email policy" value={content.verifiedClientEmailPolicyReference} onChange={value => updateReference('verifiedClientEmailPolicyReference', value)} />
      </fieldset>

      <fieldset className="grid gap-4 rounded-lg border border-zinc-200 p-4 sm:grid-cols-2">
        <legend className="px-2 font-semibold text-zinc-900">Records and retention</legend>
        <ReferenceField label="Retention policy reference" value={content.retentionPolicyReference} onChange={value => updateReference('retentionPolicyReference', value)} />
      </fieldset>

      <fieldset className="space-y-3 rounded-lg border border-zinc-200 p-4">
        <legend className="px-2 font-semibold text-zinc-900">Supporting sources</legend>
        <p className="text-sm text-zinc-600">Add references to documents or decisions that support this proposal. Do not attach customer records or credentials.</p>
        {content.sourceReferences.map((item, index) => (
          <div key={`source-${index}`} className="grid gap-3 rounded-md bg-zinc-50 p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <TextField label={`Source ${index + 1} name`} value={item.label} maxLength={120} onChange={value => setContent(current => ({ ...current, sourceReferences: current.sourceReferences.map((source, sourceIndex) => sourceIndex === index ? { ...source, label: value } : source) }))} />
            <TextField label="Document or decision reference" value={item.reference} maxLength={240} onChange={value => setContent(current => ({ ...current, sourceReferences: current.sourceReferences.map((source, sourceIndex) => sourceIndex === index ? { ...source, reference: value } : source) }))} />
            <Button type="button" variant="secondary" onClick={() => setContent(current => ({ ...current, sourceReferences: current.sourceReferences.filter((_, sourceIndex) => sourceIndex !== index) }))}>Remove source</Button>
          </div>
        ))}
        <Button type="button" variant="secondary" disabled={content.sourceReferences.length >= 30} onClick={() => setContent(current => ({ ...current, sourceReferences: [...current.sourceReferences, { label: '', reference: '' }] }))}>Add a source</Button>
      </fieldset>

      <label className="grid gap-1 text-sm font-medium text-zinc-900">Reason for this proposal or revision
        <textarea className="min-h-20 rounded-md border border-zinc-300 p-3 font-normal" value={revisionNote} maxLength={500} required onChange={event => setRevisionNote(event.target.value)} aria-describedby="finance-revision-reason-help" />
        <span id="finance-revision-reason-help" className="text-xs font-normal text-zinc-600">Explain what is being proposed or changed. This reason becomes part of the permanent revision history.</span>
      </label>

      {message && <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">{message}</p>}
      <div className="flex flex-wrap gap-2 border-t border-zinc-200 pt-4">
        <Button type="submit" disabled={isSaving}>{isSaving ? 'Saving proposal…' : 'Save proposal'}</Button>
        <Button type="button" variant="secondary" disabled={isSaving} onClick={cancel}>Cancel</Button>
      </div>
    </form>
  );
}

function ProposalPreview({ item, timeZone, close }: { item: FinanceConfigurationDraftItem; timeZone: string; close: () => void }) {
  const fields: Array<[string, string | null]> = [
    ['Business name', item.content.legalEntity.proposedName],
    ['Registration reference', item.content.legalEntity.registrationReference],
    ['Business address', item.content.legalEntity.businessAddress],
    ['Business contact reference', item.content.legalEntity.businessContactReference],
    ['Currency code', item.content.currencyCode],
    ['Rate schedule', item.content.rateScheduleReference],
    ['Tax treatment', item.content.taxTreatmentReference],
    ['Payment terms', item.content.paymentTermsReference],
    ['Invoice numbering', item.content.invoiceNumberingRuleReference],
    ['Receipt numbering', item.content.receiptNumberingRuleReference],
    ['Payment confirmation source', item.content.paymentVerificationSourceReference],
    ['Payment evidence policy', item.content.paymentEvidencePolicyReference],
    ['Showroom guarantee authority', item.content.showroomGuaranteeAuthorityReference],
    ['Invoice template', item.content.invoiceTemplateReference],
    ['Receipt template', item.content.receiptTemplateReference],
    ['Email sender setup', item.content.emailSenderConfigurationReference],
    ['Verified client email policy', item.content.verifiedClientEmailPolicyReference],
    ['Correction policy', item.content.correctionPolicyReference],
    ['Retention policy', item.content.retentionPolicyReference],
  ];
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm" aria-labelledby="finance-proposal-preview-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">Proposal only</p>
          <h2 id="finance-proposal-preview-heading" className="mt-1 text-xl font-semibold">Proposal {item.draftId.slice(0, 8)} · revision {item.revision}</h2>
          <p className="mt-1 text-sm text-zinc-600">{item.isCurrent ? 'Current revision' : 'Earlier revision'} · {dateTime(item.createdAt, timeZone)}</p>
        </div>
        <Button variant="secondary" onClick={close}>Close details</Button>
      </div>
      <p className="mt-4 rounded-md bg-zinc-100 p-3 text-sm"><strong>Reason:</strong> {item.revisionNote}</p>
      <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {fields.map(([label, value]) => <div key={label} className="min-w-0 border-l-2 border-blue-700 pl-3"><dt className="text-xs font-semibold text-zinc-600">{label}</dt><dd className="mt-1 break-words text-sm text-zinc-950">{value ?? 'Not provided'}</dd></div>)}
      </dl>
      {item.content.sourceReferences.length > 0 && <div className="mt-5"><h3 className="font-semibold">Supporting sources</h3><ul className="mt-2 list-inside list-disc space-y-1 text-sm">{item.content.sourceReferences.map((source, index) => <li key={`${source.reference}-${index}`}>{source.label}: {source.reference}</li>)}</ul></div>}
      <p className="mt-5 text-sm font-medium text-amber-800">This proposal is not approved or in use.</p>
    </section>
  );
}

function TextField({ label, value, onChange, help, maxLength }: { label: string; value: string; onChange: (value: string) => void; help?: string; maxLength?: number }) {
  return <label className="grid min-w-0 gap-1 text-sm font-medium text-zinc-900">{label}
    <input className="min-w-0 rounded-md border border-zinc-300 p-3 font-normal" value={value} maxLength={maxLength ?? 240} onChange={event => onChange(event.target.value)} />
    {help && <span className="text-xs font-normal leading-5 text-zinc-600">{help}</span>}
  </label>;
}

function TextAreaField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="grid min-w-0 gap-1 text-sm font-medium text-zinc-900">{label}
    <textarea className="min-w-0 rounded-md border border-zinc-300 p-3 font-normal" value={value} maxLength={500} onChange={event => onChange(event.target.value)} />
  </label>;
}

function ReferenceField({ label, value, onChange, help }: { label: string; value: string | null; onChange: (value: string) => void; help?: string }) {
  return <TextField label={label} value={value ?? ''} onChange={onChange} help={help ?? 'Reference only. Leave blank if this item has not been approved.'} />;
}
