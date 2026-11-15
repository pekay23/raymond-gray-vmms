import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { ApiError, request, detailSchema, intakeFactsPath } from "./api";
import type { WorkOrder } from "./api";
import { useStaff } from "./workspace";
import { Button, FormError, dateTime, useOnline } from "./ui";

type FactKind =
  | "condition-observation"
  | "damage-observation"
  | "accessory-observation"
  | "key-observation"
  | "fuel-reading"
  | "custody-observation"
  | "safety-observation";

const kinds: Array<{ value: FactKind; label: string }> = [
  { value: "condition-observation", label: "Vehicle condition" },
  { value: "damage-observation", label: "Pre-existing damage" },
  { value: "accessory-observation", label: "Accessories" },
  { value: "key-observation", label: "Keys" },
  { value: "fuel-reading", label: "Fuel reading" },
  { value: "custody-observation", label: "Vehicle or key handover" },
  { value: "safety-observation", label: "Safety observation" },
];

type Props = { order: WorkOrder; refresh: () => void };
export function IntakeFacts({ order, refresh }: Props) {
  const { site } = useStaff();
  const online = useOnline();
  const [kind, setKind] = useState<FactKind>("condition-observation");
  const [area, setArea] = useState("");
  const [description, setDescription] = useState("");
  const [reading, setReading] = useState("");
  const [unit, setUnit] = useState("%");
  const [observation, setObservation] = useState("");
  const [evidenceIds, setEvidenceIds] = useState<string[]>([]);
  const [supersedesFactId, setSupersedesFactId] = useState("");
  const [correctionReason, setCorrectionReason] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const attempt = useRef<{ key: string; id: string } | null>(null);
  const body = makeCommandBody({ kind, area, description, reading, unit, observation, evidenceIds, supersedesFactId, correctionReason, version: order.version });
  const areaError = fieldMessage(error, "fact.area");
  const descriptionError = fieldMessage(error, "fact.description");
  const readingError = fieldMessage(error, "fact.value");
  const unitError = fieldMessage(error, "fact.unit");
  const observationError = fieldMessage(error, "fact.observation");
  const correctionReasonError = fieldMessage(error, "correctionReason");
  const evidenceError = fieldMessage(error, "fact.evidenceIds");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);
    setError(null);
    if (!body) return;
    const key = JSON.stringify(body);
    if (!attempt.current || attempt.current.key !== key) attempt.current = { key, id: crypto.randomUUID() };
    setIsSubmitting(true);
    try {
      await request(intakeFactsPath(site.id, order.id), detailSchema, {
        method: "POST",
        commandId: attempt.current.id,
        body,
      });
      attempt.current = null;
      setDescription("");
      setArea("");
      setReading("");
      setObservation("");
      setEvidenceIds([]);
      setSupersedesFactId("");
      setCorrectionReason("");
      setNotice("Saved. The initial vehicle checks are still pending.");
      refresh();
    } catch (requestError) {
      setError(requestError);
    } finally {
      setIsSubmitting(false);
    }
  }

  const eligibleEvidence = order.evidence.filter((item) => item.state === "accepted" && item.attachedAt !== null);
  const supersededFactIds = new Set(order.intakeFacts.flatMap((item) => item.supersedesFactId ? [item.supersedesFactId] : []));
  const correctable = order.intakeFacts.filter((item) => item.fact.kind === kind && !supersededFactIds.has(item.id));
  const selectedFact = order.intakeFacts.find((item) => item.id === supersedesFactId);

  return (
    <section className="panel" aria-labelledby="intake-facts-title">
      <div className="panel-heading">
        <div>
          <h2 id="intake-facts-title" className="section-title">Vehicle check-in notes</h2>
          <p className="mt-1 text-sm text-zinc-600">Record what staff saw or what the customer reported. These notes do not confirm ownership or handover, clear a safety concern, or complete the initial vehicle checks.</p>
        </div>
      </div>
      <div className="space-y-5 p-5 sm:p-6">
        <ul className="space-y-3" aria-label="Vehicle check-in notes">
          {order.intakeFacts.map((item) => (
            <li key={item.id} className="rounded-lg border border-zinc-200 border-l-2 border-l-emerald-600 bg-white p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h3 className="text-sm font-semibold">{labelFor(item.fact.kind)}{supersededFactIds.has(item.id) && <span className="ml-2 text-xs font-normal text-zinc-500">Corrected by a newer entry</span>}</h3>
                <p className="text-xs text-zinc-500">{item.recordedBy} · {dateTime(item.recordedAt, site.timeZone)}</p>
              </div>
              <p className="mt-2 text-sm text-zinc-700">{describeFact(item.fact)}</p>
              {item.fact.evidenceIds.length > 0 && <p className="mt-2 text-xs text-zinc-500">{item.fact.evidenceIds.length} file{item.fact.evidenceIds.length === 1 ? "" : "s"} that passed the security check linked</p>}
              {item.supersedesFactId && <p className="mt-2 text-xs text-zinc-500">Corrects an earlier entry · {item.correctionReason}</p>}
            </li>
          ))}
        </ul>
        {order.intakeFacts.length === 0 && <p className="text-sm text-zinc-500">No vehicle check-in notes yet.</p>}
        {notice && <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{notice}</p>}
        <form aria-busy={isSubmitting} className="space-y-4 border-t border-zinc-200 pt-5" onSubmit={(event) => { void submit(event); }}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="intake-fact-kind">What are you recording?</label>
              <select id="intake-fact-kind" value={kind} onChange={(event) => { setKind(event.target.value as FactKind); setSupersedesFactId(""); setCorrectionReason(""); setError(null); }} disabled={!online || isSubmitting}>
                {kinds.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </div>
            {kind === "condition-observation" || kind === "damage-observation" ? (
              <div><label htmlFor="intake-fact-area">Vehicle area</label><input id="intake-fact-area" maxLength={160} required value={area} onChange={(event) => { setArea(event.target.value); setError(null); }} disabled={!online || isSubmitting} aria-invalid={Boolean(areaError) || undefined} aria-describedby={areaError ? "intake-fact-area-error" : undefined} />{areaError && <FieldError id="intake-fact-area-error" message={areaError} />}</div>
            ) : kind === "fuel-reading" ? (
              <div className="grid grid-cols-2 gap-3">
                <div><label htmlFor="intake-fact-reading">Reading</label><input id="intake-fact-reading" type="number" min="0" max="100000" step="any" required value={reading} onChange={(event) => { setReading(event.target.value); setError(null); }} disabled={!online || isSubmitting} aria-invalid={Boolean(readingError) || undefined} aria-describedby={readingError ? "intake-fact-reading-error" : undefined} />{readingError && <FieldError id="intake-fact-reading-error" message={readingError} />}</div>
                <div><label htmlFor="intake-fact-unit">Unit</label><input id="intake-fact-unit" maxLength={160} required value={unit} onChange={(event) => { setUnit(event.target.value); setError(null); }} disabled={!online || isSubmitting} aria-invalid={Boolean(unitError) || undefined} aria-describedby={unitError ? "intake-fact-unit-error" : undefined} />{unitError && <FieldError id="intake-fact-unit-error" message={unitError} />}</div>
              </div>
            ) : null}
          </div>
          {kind === "fuel-reading" ? (
              <div><label htmlFor="intake-fact-observation">What does this reading show?</label><textarea id="intake-fact-observation" maxLength={4000} required value={observation} onChange={(event) => { setObservation(event.target.value); setError(null); }} disabled={!online || isSubmitting} aria-invalid={Boolean(observationError) || undefined} aria-describedby={observationError ? "intake-fact-observation-error" : undefined} />{observationError && <FieldError id="intake-fact-observation-error" message={observationError} />}</div>
          ) : (
            <div><label htmlFor="intake-fact-description">What was observed or reported?</label><textarea id="intake-fact-description" maxLength={4000} required value={description} onChange={(event) => { setDescription(event.target.value); setError(null); }} disabled={!online || isSubmitting} aria-invalid={Boolean(descriptionError) || undefined} aria-describedby={descriptionError ? "intake-fact-description-error" : undefined} />{descriptionError && <FieldError id="intake-fact-description-error" message={descriptionError} />}</div>
          )}
          {eligibleEvidence.length > 0 && (
            <fieldset className="space-y-2" aria-invalid={Boolean(evidenceError) || undefined} aria-describedby={evidenceError ? "intake-fact-evidence-error" : undefined}>
              <legend className="text-sm font-medium">Attach files that passed the security check</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {eligibleEvidence.map((item) => <label key={item.evidenceId} className="flex min-w-0 items-start gap-2 rounded-md border border-zinc-200 p-2 text-sm font-normal"><input type="checkbox" className="mt-1" checked={evidenceIds.includes(item.evidenceId)} onChange={(event) => { setEvidenceIds((current) => event.target.checked ? [...current, item.evidenceId] : current.filter((id) => id !== item.evidenceId)); setError(null); }} disabled={!online || isSubmitting} /><span className="break-all">{item.displayName}</span></label>)}
              </div>
              {evidenceError && <FieldError id="intake-fact-evidence-error" message={evidenceError} />}
            </fieldset>
          )}
          {correctable.length > 0 && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div><label htmlFor="intake-fact-correction">Correct an earlier entry (optional)</label><select id="intake-fact-correction" value={supersedesFactId} onChange={(event) => { setSupersedesFactId(event.target.value); setCorrectionReason(""); setError(null); }} disabled={!online || isSubmitting}><option value="">New observation</option>{correctable.map((item) => <option key={item.id} value={item.id}>{dateTime(item.recordedAt, site.timeZone)} · {describeFact(item.fact).slice(0, 72)}</option>)}</select></div>
              {selectedFact && <div><label htmlFor="intake-fact-correction-reason">Correction reason</label><input id="intake-fact-correction-reason" maxLength={2000} required value={correctionReason} onChange={(event) => { setCorrectionReason(event.target.value); setError(null); }} disabled={!online || isSubmitting} aria-invalid={Boolean(correctionReasonError) || undefined} aria-describedby={correctionReasonError ? "intake-fact-correction-reason-error" : undefined} />{correctionReasonError && <FieldError id="intake-fact-correction-reason-error" message={correctionReasonError} />}</div>}
            </div>
          )}
          {error !== null && <FormError error={error} />}
          <div className="flex flex-wrap items-center gap-3"><Button type="submit" disabled={!online || isSubmitting}>{isSubmitting ? "Recording…" : online ? "Record observation" : "Connect to record"}</Button><p className="text-xs text-zinc-500">Server time and your staff identity are recorded automatically.</p></div>
        </form>
      </div>
    </section>
  );
}

function makeCommandBody(input: {
  kind: FactKind; area: string; description: string; reading: string; unit: string;
  observation: string; evidenceIds: string[]; supersedesFactId: string; correctionReason: string; version: number;
}) {
  const shared = { evidenceIds: input.evidenceIds };
  let fact: Record<string, unknown>;
  if (input.kind === "fuel-reading") {
    fact = { kind: input.kind, value: Number(input.reading), unit: input.unit.trim(), observation: input.observation.trim(), ...shared };
  } else if (input.kind === "condition-observation" || input.kind === "damage-observation") {
    fact = { kind: input.kind, area: input.area.trim(), description: input.description.trim(), ...shared };
  } else {
    fact = { kind: input.kind, description: input.description.trim(), ...shared };
  }
  return {
    expectedVersion: input.version,
    fact,
    ...(input.supersedesFactId ? { supersedesFactId: input.supersedesFactId, correctionReason: input.correctionReason.trim() } : {}),
  };
}

function labelFor(kind: FactKind) { return kinds.find((item) => item.value === kind)?.label ?? "Reception observation"; }
function fieldMessage(error: unknown, path: string): string | undefined {
  if (!(error instanceof ApiError)) return undefined;
  const message = error.fields[path];
  return Array.isArray(message) ? message.join(" ") : message;
}
function FieldError({ id, message }: { id: string; message: string }) {
  return <p id={id} className="mt-1 text-sm text-red-800">{message}</p>;
}
function describeFact(fact: WorkOrder["intakeFacts"][number]["fact"]) {
  switch (fact.kind) {
    case "condition-observation": case "damage-observation": return `${fact.area} · ${fact.description}`;
    case "fuel-reading": return `${fact.value} ${fact.unit} · ${fact.observation}`;
    default: return fact.description;
  }
}
