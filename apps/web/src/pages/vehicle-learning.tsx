import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpenCheck, Save, Send } from 'lucide-react';
import { useRef, useState } from 'react';
import { request, sitePath, vehicleLearningEntrySchema, vehicleLearningListSchema } from '../api';
import sourceText from '../../../../docs/sources/ev-afro-service-centre-transcription.md?raw';
import { useStaff } from '../workspace';
import { VehicleLearningActivity } from '../vehicle-learning-activity';
import { VehicleLearningLibrary } from '../vehicle-learning-library';
import { VehicleLearningReviewQueue } from '../vehicle-learning-review';
import { Button, Empty, Failure, Loading, PageHeading, useOnline, useToast } from '../ui';
import {
  createVehicleLearningAssessment,
  evidenceKindLabels,
  findingStateLabels,
  learningQuestionItems,
  learningSystemGroups,
  type AssessmentFinding,
  type SystemAssessment,
  type VehicleLearningAssessment,
} from '../vehicle-learning-assessment';

type EvidenceCitation = AssessmentFinding['citations'][number];

export function VehicleLearning() {
  const { site } = useStaff();
  const online = useOnline();
  const toast = useToast();
  const client = useQueryClient();
  const commandId = useRef<{ key: string; payload: string } | null>(null);
  const [title, setTitle] = useState('');
  const [makeModel, setMakeModel] = useState('');
  const [assessment, setAssessment] = useState(createVehicleLearningAssessment);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [version, setVersion] = useState<number | null>(null);
  const [error, setError] = useState('');

  const notes = useQuery({
    queryKey: ['vehicle-learning', site.id],
    queryFn: () => request(`${sitePath(site.id)}/vehicle-learning`, vehicleLearningListSchema),
    enabled: online,
    retry: false,
  });

  function clearForm() {
    setDraftId(null);
    setVersion(null);
    setTitle('');
    setMakeModel('');
    setAssessment(createVehicleLearningAssessment());
    commandId.current = null;
  }

  const save = useMutation({
    mutationFn: (status: 'draft' | 'submitted') => {
      const body = { id: draftId, expectedVersion: version, title, makeModel, assessment, status };
      const payload = JSON.stringify(body);
      if (!commandId.current || commandId.current.payload !== payload)
        commandId.current = { payload, key: crypto.randomUUID() };
      return request(`${sitePath(site.id)}/vehicle-learning`, vehicleLearningEntrySchema, {
        method: 'POST', commandId: commandId.current.key, body,
      });
    },
    onSuccess: async entry => {
      commandId.current = null;
      setDraftId(entry.id);
      setVersion(entry.version);
      await Promise.all([
        client.invalidateQueries({ queryKey: ['vehicle-learning', site.id] }),
        client.invalidateQueries({ queryKey: ['vehicle-learning-activity', site.id] }),
      ]);
      if (entry.status === 'submitted') clearForm();
      toast(entry.status === 'submitted'
        ? 'Saved for review. Staff with a separate review permission can see this submission.'
        : 'Learning note saved.');
      setError('');
    },
    onError: async value => {
      setError(value instanceof Error ? value.message : 'Could not save this learning note.');
      await client.invalidateQueries({ queryKey: ['vehicle-learning', site.id] });
    },
  });

  function load(entry: NonNullable<typeof notes.data>['items'][number]) {
    setDraftId(entry.id);
    setVersion(entry.version);
    setTitle(entry.title);
    setMakeModel(entry.makeModel);
    setAssessment(entry.assessment);
    setError('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function updatePreliminary<K extends keyof VehicleLearningAssessment['preliminary']>(
    key: K,
    value: VehicleLearningAssessment['preliminary'][K],
  ) {
    setAssessment(current => ({ ...current, preliminary: { ...current.preliminary, [key]: value } }));
  }

  function updateQuestion(key: keyof VehicleLearningAssessment['technicalFindings'], next: AssessmentFinding) {
    setAssessment(current => ({ ...current, technicalFindings: { ...current.technicalFindings, [key]: next } }));
  }

  function updateSystem(key: string, next: SystemAssessment) {
    setAssessment(current => ({ ...current, systems: { ...current.systems, [key]: next } }));
  }

  const canSave = online && !save.isPending && Boolean(title.trim() && makeModel.trim());

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <PageHeading eyebrow="Training and reference" title="Vehicle learning">
        Open to active after-sales roles, including the Head of Service Centre, Team Leads, Supervisors, Engineers, Technicians and trainees. Learn unfamiliar makes and models, record evidence, and save questions for review.
      </PageHeading>

      <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
        <strong>Learning exercise only:</strong> this does not authorize diagnosis, repair, vehicle movement or high-voltage work. Follow approved procedures and role qualifications.
      </div>

      <VehicleLearningLibrary siteId={site.id} timeZone={site.timeZone} />

      <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm" aria-labelledby="exercise-heading">
        <div className="flex items-center gap-2">
          <BookOpenCheck aria-hidden="true" />
          <h2 id="exercise-heading" className="text-xl font-semibold">Vehicle identification exercise</h2>
        </div>
        <p className="mt-2 text-sm text-zinc-600">The form follows the supplied EV Afriq exercise. A photo, badge or appearance alone cannot confirm a vehicle type or driven axle.</p>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1 text-sm font-medium">Exercise title
            <input className="rounded-md border border-zinc-300 p-2" value={title} onChange={event => setTitle(event.target.value)} maxLength={160} />
          </label>
          <label className="grid gap-1 text-sm font-medium">Make, model or variant
            <input className="rounded-md border border-zinc-300 p-2" value={makeModel} onChange={event => setMakeModel(event.target.value)} maxLength={180} />
          </label>
        </div>
        <p className="mt-2 text-xs text-zinc-600">Use make, model and variant only. Do not enter a VIN, registration number, customer name or staff personal details.</p>

        <div className="mt-5 space-y-3">
          <details open className="rounded-lg border border-zinc-200 p-4">
            <summary className="cursor-pointer font-semibold">1. First look and initial guess</summary>
            <p className="mt-2 text-sm text-zinc-600">Record observations before technical checks. Treat the vehicle type and drivetrain here as hypotheses.</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="grid gap-1 text-sm font-medium">Body style and approximate size
                <input className="rounded-md border border-zinc-300 p-2" value={assessment.preliminary.bodyStyleAndApproximateSize} onChange={event => updatePreliminary('bodyStyleAndApproximateSize', event.target.value)} maxLength={500} />
              </label>
              <label className="grid gap-1 text-sm font-medium">Likely vehicle type
                <select className="rounded-md border border-zinc-300 p-2" value={assessment.preliminary.vehicleType.answer} onChange={event => updatePreliminary('vehicleType', { ...assessment.preliminary.vehicleType, answer: event.target.value as typeof assessment.preliminary.vehicleType.answer, state: event.target.value === 'unknown' ? 'unknown' : 'hypothesis' })}>
                  {['unknown', 'BEV', 'PHEV', 'HEV', 'EREV', 'REEV', 'ICE'].map(value => <option key={value} value={value}>{value === 'unknown' ? 'Not sure yet' : value}</option>)}
                </select>
              </label>
              <label className="grid gap-1 text-sm font-medium">Likely drivetrain
                <select className="rounded-md border border-zinc-300 p-2" value={assessment.preliminary.drivetrain.answer} onChange={event => updatePreliminary('drivetrain', { ...assessment.preliminary.drivetrain, answer: event.target.value as typeof assessment.preliminary.drivetrain.answer, state: event.target.value === 'unknown' ? 'unknown' : 'hypothesis' })}>
                  {['unknown', 'FWD', 'RWD', 'AWD'].map(value => <option key={value} value={value}>{value === 'unknown' ? 'Not sure yet' : value}</option>)}
                </select>
              </label>
              <label className="grid gap-1 text-sm font-medium">Confidence in this first guess
                <select className="rounded-md border border-zinc-300 p-2" value={assessment.preliminary.vehicleType.confidence} onChange={event => updatePreliminary('vehicleType', { ...assessment.preliminary.vehicleType, confidence: event.target.value as typeof assessment.preliminary.vehicleType.confidence })}>
                  {['not-assessed', 'low', 'medium', 'high'].map(value => <option key={value} value={value}>{value === 'not-assessed' ? 'Not assessed' : value}</option>)}
                </select>
              </label>
              <label className="grid gap-1 text-sm font-medium sm:col-span-2">Two visible clues
                <span className="grid gap-2 sm:grid-cols-2">
                  <input aria-label="First visible clue" className="rounded-md border border-zinc-300 p-2" value={assessment.preliminary.visibleClues[0]} onChange={event => updatePreliminary('visibleClues', [event.target.value, assessment.preliminary.visibleClues[1]])} maxLength={300} placeholder="Clue 1" />
                  <input aria-label="Second visible clue" className="rounded-md border border-zinc-300 p-2" value={assessment.preliminary.visibleClues[1]} onChange={event => updatePreliminary('visibleClues', [assessment.preliminary.visibleClues[0], event.target.value])} maxLength={300} placeholder="Clue 2" />
                </span>
              </label>
              <label className="grid gap-1 text-sm font-medium sm:col-span-2">Assumptions or reasons for uncertainty
                <textarea className="min-h-20 rounded-md border border-zinc-300 p-2" value={assessment.preliminary.assumptions} onChange={event => updatePreliminary('assumptions', event.target.value)} maxLength={1200} />
              </label>
              <CitationEditor title="Evidence for the first guess" citations={assessment.preliminary.vehicleType.citations} onChange={citations => updatePreliminary('vehicleType', { ...assessment.preliminary.vehicleType, citations })} />
            </div>
          </details>

          <details className="rounded-lg border border-zinc-200 p-4">
            <summary className="cursor-pointer font-semibold">2. Check stronger evidence</summary>
            <p className="mt-2 text-sm text-zinc-600">For each finding, record its status and the exact source. Use “Unknown” when it cannot be safely confirmed.</p>
            <div className="mt-4 space-y-3">
              {learningQuestionItems.map(([key, prompt]) => {
                const finding = assessment.technicalFindings[key]!;
                return (
                  <article key={key} className="rounded-md border border-zinc-200 p-3">
                    <h3 className="font-medium">{prompt}</h3>
                    <FindingEditor finding={finding} onChange={next => updateQuestion(key, next)} answerLabel="Finding" />
                  </article>
                );
              })}
            </div>
          </details>

          <details className="rounded-lg border border-zinc-200 p-4">
            <summary className="cursor-pointer font-semibold">3. Identify systems and components</summary>
            <p className="mt-2 text-sm text-zinc-600">Use observation and approved information only. “Not applicable” needs a reason. Do not remove covers or use a lift as part of this exercise.</p>
            <div className="mt-4 space-y-4">
              {learningSystemGroups.map(group => (
                <section key={group.title} aria-label={group.title}>
                  <h3 className="border-b border-zinc-200 pb-2 font-semibold">{group.title}</h3>
                  <div className="mt-2 grid gap-3 lg:grid-cols-2">
                    {group.items.map(([key, label]) => (
                      <SystemEditor key={key} systemKey={key} label={label} value={assessment.systems[key]!} onChange={next => updateSystem(key, next)} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </details>

          <details className="rounded-lg border border-zinc-200 p-4">
            <summary className="cursor-pointer font-semibold">4. Trace energy flow</summary>
            <p className="mt-2 text-sm text-zinc-600">Explain the path supported by evidence. Mark a route unknown when the source does not establish it.</p>
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              <EnergyPathEditor title="Driving" value={assessment.energyPaths.driving} onChange={value => setAssessment(current => ({ ...current, energyPaths: { ...current.energyPaths, driving: value } }))} />
              <EnergyPathEditor title="AC charging" value={assessment.energyPaths.acCharging} onChange={value => setAssessment(current => ({ ...current, energyPaths: { ...current.energyPaths, acCharging: value } }))} />
              <EnergyPathEditor title="DC charging" value={assessment.energyPaths.dcCharging} onChange={value => setAssessment(current => ({ ...current, energyPaths: { ...current.energyPaths, dcCharging: value } }))} />
              <EnergyPathEditor title="Regenerative braking" value={assessment.energyPaths.regenerativeBraking} onChange={value => setAssessment(current => ({ ...current, energyPaths: { ...current.energyPaths, regenerativeBraking: value } }))} />
            </div>
          </details>

          <details className="rounded-lg border border-zinc-200 p-4">
            <summary className="cursor-pointer font-semibold">5. Explain what you learned</summary>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <TextAnswer label="Explain the difference between an inverter, a DC/DC converter and an onboard charger" value={assessment.explanations.inverterDcDcAndOnboardCharger} onChange={value => setAssessment(current => ({ ...current, explanations: { ...current.explanations, inverterDcDcAndOnboardCharger: value } }))} />
              <TextAnswer label="What evidence distinguishes a PHEV from an EREV?" value={assessment.explanations.phevVersusErev} onChange={value => setAssessment(current => ({ ...current, explanations: { ...current.explanations, phevVersusErev: value } }))} />
              <TextAnswer label="What evidence proves the driven axle or axles?" value={assessment.explanations.evidenceForDrivenAxles} onChange={value => setAssessment(current => ({ ...current, explanations: { ...current.explanations, evidenceForDrivenAxles: value } }))} />
              <TextAnswer label="Which systems may be hidden, and how can you verify them safely?" value={assessment.explanations.safelyVerifyingHiddenSystems} onChange={value => setAssessment(current => ({ ...current, explanations: { ...current.explanations, safelyVerifyingHiddenSystems: value } }))} />
            </div>
          </details>
        </div>

        <label className="mt-5 grid gap-1 text-sm font-medium">Questions or comments for later review
          <textarea className="min-h-24 rounded-md border border-zinc-300 p-2" value={assessment.learnerQuestions} onChange={event => setAssessment(current => ({ ...current, learnerQuestions: event.target.value }))} maxLength={2000} />
        </label>
        <p className="mt-3 text-sm text-zinc-600">Drafts are private. Save a draft to continue later, or submit it for review. Only staff with separately assigned review permission can see submitted notes. A review does not approve technical facts or authorize work.</p>
        {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button disabled={!canSave} onClick={() => save.mutate('draft')}><Save className="size-4" />Save draft</Button>
          <Button disabled={!canSave} onClick={() => save.mutate('submitted')}><Send className="size-4" />Save for review</Button>
          {draftId && <Button variant="secondary" disabled={save.isPending} onClick={clearForm}>New exercise</Button>}
          {!online && <span className="self-center text-sm text-amber-800">Connect to save or submit your note.</span>}
        </div>
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm" aria-labelledby="notes-heading">
        <h2 id="notes-heading" className="text-xl font-semibold">My learning notes</h2>
        {notes.isLoading ? <Loading label="Loading your notes" /> : notes.isError ? <Failure error={notes.error} retry={() => void notes.refetch()} />
          : !notes.data || notes.data.items.length === 0 ? <Empty title="No saved notes yet">Start an exercise above and save it here.</Empty>
            : <ul className="mt-3 divide-y divide-zinc-200">{notes.data.items.map(entry => (
              <li key={entry.id} className="py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">{entry.title} · {entry.makeModel}</p>
                    <p className="text-sm text-zinc-600">First guess: {entry.assessment.preliminary.vehicleType.answer} · {entry.assessment.preliminary.drivetrain.answer} · {entry.status === 'draft' ? 'Draft' : entry.reviewDecision === 'changes-requested' ? 'Changes requested' : entry.reviewDecision === 'reviewed-learning-record' ? 'Reviewed as a learning note' : 'Submitted for review'}</p>
                  </div>
                  {(entry.status === 'draft' || entry.reviewDecision === 'changes-requested') && <Button onClick={() => load(entry)}>{entry.status === 'draft' ? 'Continue draft' : 'Update note'}</Button>}
                </div>
                <VehicleLearningActivity entryId={entry.id} siteId={site.id} timeZone={site.timeZone} />
              </li>
            ))}</ul>}
      </section>

      <VehicleLearningReviewQueue siteId={site.id} timeZone={site.timeZone} />

      <details className="rounded-xl border border-zinc-200 bg-white p-5">
        <summary className="cursor-pointer text-lg font-semibold">Source exercise: EV Afriq Service Centre</summary>
        <p className="mt-2 text-sm text-zinc-600">The complete source transcription is shown below. It is a student exercise, not an approved service procedure or model-specific technical reference.</p>
        <pre tabIndex={0} aria-label="Complete EV Afriq Service Centre source transcription" className="mt-4 max-h-[70vh] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-zinc-50 p-4 text-xs leading-6">{sourceText}</pre>
      </details>
    </div>
  );
}

function FindingEditor({ finding, onChange, answerLabel }: { finding: AssessmentFinding; onChange: (next: AssessmentFinding) => void; answerLabel: string }) {
  return (
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      <label className="grid gap-1 text-sm font-medium sm:col-span-2">{answerLabel}
        <textarea className="min-h-20 rounded-md border border-zinc-300 p-2" value={finding.answer} onChange={event => onChange({ ...finding, answer: event.target.value })} maxLength={1200} />
      </label>
      <label className="grid gap-1 text-sm font-medium">Finding status
        <select className="rounded-md border border-zinc-300 p-2" value={finding.state} onChange={event => onChange({ ...finding, state: event.target.value as AssessmentFinding['state'] })}>
          {findingStateLabels.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label className="grid gap-1 text-sm font-medium">Confidence
        <select className="rounded-md border border-zinc-300 p-2" value={finding.confidence} onChange={event => onChange({ ...finding, confidence: event.target.value as AssessmentFinding['confidence'] })}>
          {['not-assessed', 'low', 'medium', 'high'].map(value => <option key={value} value={value}>{value === 'not-assessed' ? 'Not assessed' : value}</option>)}
        </select>
      </label>
      <CitationEditor title="Evidence source" citations={finding.citations} onChange={citations => onChange({ ...finding, citations })} />
      <label className="grid gap-1 text-sm font-medium sm:col-span-2">What is still uncertain? If not applicable, explain why.
        <textarea className="min-h-16 rounded-md border border-zinc-300 p-2" value={finding.uncertainty} onChange={event => onChange({ ...finding, uncertainty: event.target.value })} maxLength={1200} />
      </label>
    </div>
  );
}

function SystemEditor({ systemKey, label, value, onChange }: { systemKey: string; label: string; value: SystemAssessment; onChange: (next: SystemAssessment) => void }) {
  return (
    <article className="rounded-md border border-zinc-200 p-3">
      <h4 className="font-medium">{label}</h4>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm font-medium">Status
          <select className="rounded-md border border-zinc-300 p-2" value={value.state} onChange={event => onChange({ ...value, state: event.target.value as SystemAssessment['state'] })}>
            {findingStateLabels.filter(([state]) => state !== 'hypothesis').map(([state, name]) => <option key={state} value={state}>{name}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-sm font-medium">Confidence
          <select className="rounded-md border border-zinc-300 p-2" value={value.confidence} onChange={event => onChange({ ...value, confidence: event.target.value as SystemAssessment['confidence'] })}>
            {['not-assessed', 'low', 'medium', 'high'].map(item => <option key={item} value={item}>{item === 'not-assessed' ? 'Not assessed' : item}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-sm font-medium sm:col-span-2">Non-invasive location or source
          <input className="rounded-md border border-zinc-300 p-2" value={value.nonInvasiveLocationOrSource} onChange={event => onChange({ ...value, nonInvasiveLocationOrSource: event.target.value })} maxLength={1000} placeholder="Visible location or document section only" />
        </label>
        <label className="grid gap-1 text-sm font-medium sm:col-span-2">Notes or reason this is unknown / not applicable
          <textarea className="min-h-16 rounded-md border border-zinc-300 p-2" value={value.notes} onChange={event => onChange({ ...value, notes: event.target.value })} maxLength={1200} />
        </label>
        <CitationEditor title="Evidence source" citations={value.citations} onChange={citations => onChange({ ...value, citations })} />
        <label className="grid gap-1 text-sm font-medium sm:col-span-2">Remaining uncertainty
          <textarea className="min-h-16 rounded-md border border-zinc-300 p-2" value={value.uncertainty} onChange={event => onChange({ ...value, uncertainty: event.target.value })} maxLength={1200} />
        </label>
      </div>
      <span className="sr-only">System key: {systemKey}</span>
    </article>
  );
}

function CitationEditor({ title, citations, onChange }: { title: string; citations: EvidenceCitation[]; onChange: (next: EvidenceCitation[]) => void }) {
  const current = citations[0] ?? { kind: 'visual' as const, sourceTitle: '', revisionOrDate: '', pageOrSection: '' };
  function update<K extends keyof EvidenceCitation>(key: K, value: EvidenceCitation[K]) {
    const next = { ...current, [key]: value };
    const hasContent = Boolean(next.sourceTitle.trim() || next.revisionOrDate.trim() || next.pageOrSection.trim());
    onChange(hasContent || key === 'kind' ? [next] : []);
  }
  return (
    <fieldset className="grid gap-2 rounded-md border border-zinc-200 p-3 sm:col-span-2">
      <legend className="px-1 text-sm font-medium">{title}</legend>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <label className="grid gap-1 text-xs font-medium">Source type
          <select className="rounded-md border border-zinc-300 p-2 text-sm" value={current.kind} onChange={event => update('kind', event.target.value as EvidenceCitation['kind'])}>
            {evidenceKindLabels.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-medium">Document or screen
          <input className="rounded-md border border-zinc-300 p-2 text-sm" value={current.sourceTitle} onChange={event => update('sourceTitle', event.target.value)} maxLength={180} />
        </label>
        <label className="grid gap-1 text-xs font-medium">Revision or date
          <input className="rounded-md border border-zinc-300 p-2 text-sm" value={current.revisionOrDate} onChange={event => update('revisionOrDate', event.target.value)} maxLength={120} />
        </label>
        <label className="grid gap-1 text-xs font-medium">Page or section
          <input className="rounded-md border border-zinc-300 p-2 text-sm" value={current.pageOrSection} onChange={event => update('pageOrSection', event.target.value)} maxLength={120} />
        </label>
      </div>
      <p className="text-xs text-zinc-600">Observed needs a visual source. Document-confirmed needs a label, approved document or vehicle screen. Diagnostic-confirmed needs an approved diagnostic-data source.</p>
    </fieldset>
  );
}

function EnergyPathEditor({ title, value, onChange }: { title: string; value: VehicleLearningAssessment['energyPaths']['driving']; onChange: (next: VehicleLearningAssessment['energyPaths']['driving']) => void }) {
  return (
    <fieldset className="grid gap-3 rounded-md border border-zinc-200 p-3">
      <legend className="px-1 font-medium">{title}</legend>
      <label className="grid gap-1 text-sm font-medium">What the evidence supports
        <select className="rounded-md border border-zinc-300 p-2" value={value.applicability} onChange={event => onChange({ ...value, applicability: event.target.value as typeof value.applicability })}>
          <option value="unknown">Unknown</option><option value="present">Path is present</option><option value="not-fitted">Not fitted</option>
        </select>
      </label>
      <label className="grid gap-1 text-sm font-medium">Explain the energy path
        <textarea className="min-h-20 rounded-md border border-zinc-300 p-2" value={value.explanation} onChange={event => onChange({ ...value, explanation: event.target.value })} maxLength={2000} />
      </label>
      <CitationEditor title="Evidence source" citations={value.citations} onChange={citations => onChange({ ...value, citations })} />
      <label className="grid gap-1 text-sm font-medium">Unknowns or reason not fitted
        <textarea className="min-h-16 rounded-md border border-zinc-300 p-2" value={value.unknowns} onChange={event => onChange({ ...value, unknowns: event.target.value })} maxLength={1000} />
      </label>
    </fieldset>
  );
}

function TextAnswer({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="grid gap-1 text-sm font-medium">{label}<textarea className="min-h-28 rounded-md border border-zinc-300 p-2" value={value} onChange={event => onChange(event.target.value)} maxLength={2000} /></label>;
}
