import { useRef, useState } from "react";
import type { FormEvent, InputHTMLAttributes } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ArrowRight, ClipboardList, Save, ShieldAlert } from "lucide-react";
import { detailSchema, request, sitePath } from "../api";
import { emptyIntake, loadDraft, removeDraft, saveDraft } from "../drafts";
import type { IntakeFields } from "../drafts";
import { BackToQueue, useStaff } from "../workspace";
import {
  Badge,
  Button,
  FormError,
  PageHeading,
  dateTime,
  useOnline,
} from "../ui";

function Field({
  label,
  hint,
  id,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
  id: string;
}) {
  return (
    <div>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        aria-describedby={hint ? `${id}-hint` : undefined}
        {...props}
      />
      {hint && (
        <p id={`${id}-hint`} className="field-hint">
          {hint}
        </p>
      )}
    </div>
  );
}

export function Intake() {
  const { site, session } = useStaff();
  const navigate = useNavigate();
  const client = useQueryClient();
  const online = useOnline();
  const [initial] = useState(() => loadDraft(session.user.id, site.id));
  const [fields, setFields] = useState<IntakeFields>(
    initial.draft?.fields ?? emptyIntake,
  );
  const [storageError, setStorageError] = useState<string | null>(
    initial.error,
  );
  const [savedAt, setSavedAt] = useState<string | null>(
    initial.draft?.savedAt ?? null,
  );
  const [saveOnThisTab, setSaveOnThisTab] = useState(Boolean(initial.draft));
  const draftId = useRef(initial.draft?.draftId ?? crypto.randomUUID());
  const commandId = useRef(initial.draft?.commandId ?? crypto.randomUUID());
  const save = useMutation({
    mutationFn: () =>
      request(`${sitePath(site.id)}/intake-drafts`, detailSchema, {
        method: "POST",
        commandId: commandId.current,
        body: {
          customer: {
            name: fields.customerName.trim(),
            phone: fields.phone.trim(),
            email: fields.email.trim(),
          },
          vehicle: {
            vin: fields.vin.trim().toUpperCase(),
            registration: fields.registration.trim(),
            make: fields.make.trim(),
            model: fields.model.trim(),
          },
          odometerKm: Number(fields.odometerKm),
          socPercent:
            fields.socPercent === "" ? null : Number(fields.socPercent),
          complaint: fields.complaint.trim(),
        },
      }),
    onSuccess: (order) => {
      try {
        removeDraft(session.user.id, site.id);
      } catch {
        setStorageError(
          "The submitted draft could not be removed from tab storage. Close this tab on shared equipment.",
        );
      }
      client.setQueryData(["work-order", site.id, order.id], order);
      void client.invalidateQueries({ queryKey: ["work-orders", site.id] });
      navigate(`/sites/${site.id}/work-orders/${order.id}`);
    },
  });
  function update(name: keyof IntakeFields, value: string) {
    const nextFields = { ...fields, [name]: value };
    const nextCommandId = crypto.randomUUID();
    setFields(nextFields);
    commandId.current = nextCommandId;
    if (saveOnThisTab) {
      const now = new Date().toISOString();
      try {
        saveDraft(session.user.id, site.id, {
          draftId: draftId.current,
          commandId: nextCommandId,
          fields: nextFields,
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
  function saveInTab() {
    const now = new Date().toISOString();
    try {
      saveDraft(session.user.id, site.id, {
        draftId: draftId.current,
        commandId: commandId.current,
        fields,
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
    save.mutate();
  }
  const input = (name: keyof IntakeFields) => ({
    value: fields[name],
    onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
      update(name, event.target.value),
  });
  if (!site.canWrite)
    return (
      <>
        <BackToQueue />
        <PageHeading eyebrow="Reception" title="Intake access required">
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
        title="New vehicle intake"
        action={<Badge>Unsubmitted draft</Badge>}
      >
        Record the customer, vehicle and first concern. This saves a reception
        draft; intake acceptance follows after the required evidence is
        recorded.
      </PageHeading>
      <div className="grid gap-6 xl:grid-cols-3">
        <form onSubmit={submit} className="space-y-6 xl:col-span-2">
          <fieldset
            disabled={save.isPending}
            className="panel min-w-0 p-5 sm:p-6"
          >
            <legend className="float-left mb-6 w-full text-lg font-semibold text-zinc-900">
              Customer
            </legend>
            <div className="clear-both grid gap-5 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Field
                  id="customer-name"
                  label="Customer name"
                  autoComplete="name"
                  required
                  maxLength={200}
                  {...input("customerName")}
                />
              </div>
              <Field
                id="customer-phone"
                label="Phone number"
                type="tel"
                autoComplete="tel"
                required
                maxLength={50}
                {...input("phone")}
              />
              <Field
                id="customer-email"
                label="Email address"
                type="email"
                autoComplete="email"
                maxLength={254}
                hint="Optional"
                {...input("email")}
              />
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
                  label="Vehicle identification number"
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
              <Field
                id="vehicle-registration"
                label="Registration"
                required
                maxLength={32}
                autoCapitalize="characters"
                {...input("registration")}
              />
              <Field
                id="vehicle-make"
                label="Make"
                required
                maxLength={100}
                {...input("make")}
              />
              <Field
                id="vehicle-model"
                label="Model"
                required
                maxLength={100}
                {...input("model")}
              />
              <Field
                id="odometer"
                label="Odometer in kilometres"
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
                label="State of charge in percent"
                type="number"
                min={0}
                max={100}
                step={1}
                inputMode="numeric"
                hint="Leave blank if not known or not applicable."
                {...input("socPercent")}
              />
            </div>
          </fieldset>
          <fieldset
            disabled={save.isPending}
            className="panel min-w-0 p-5 sm:p-6"
          >
            <legend className="float-left mb-2 w-full text-lg font-semibold text-zinc-900">
              First customer concern
            </legend>
            <div className="clear-both">
              <p className="mb-5 text-sm text-zinc-500">
                Keep the customer's wording. Further concerns can be added as
                separate lines.
              </p>
              <label htmlFor="customer-concern">What needs attention?</label>
              <textarea
                id="customer-concern"
                value={fields.complaint}
                onChange={(event) => update("complaint", event.target.value)}
                required
                maxLength={4000}
                rows={4}
                placeholder="Describe the symptom, when it occurs and what the customer noticed."
              />
            </div>
          </fieldset>
          <FormError error={save.error} />
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
              {save.isPending ? "Creating draft…" : "Create reception draft"}
              <ArrowRight className="size-4" aria-hidden="true" />
            </Button>
          </div>
          <p role="status" className="text-xs leading-5 text-zinc-500">
            {savedAt
              ? `Saved in this tab at ${dateTime(savedAt)}. Later edits save here automatically; this is still unsubmitted.`
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
              The server assigns a work-order reference and C01 for this
              concern. Add further concerns to that same work order.
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
