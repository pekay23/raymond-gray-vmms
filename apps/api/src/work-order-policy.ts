import { createHash } from 'node:crypto';
import { z } from 'zod';

/** Policy structure only. It deliberately contains no workshop rules or defaults. */
export const policySections = [
  'scope', 'execution', 'hse', 'inspection', 'faultDisposition', 'release',
] as const;

const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const boundedReference = z.string().trim().min(1).max(160).refine(value => !value.includes('*'), 'Wildcard references are not permitted.');
const sourcePinSchema = z.object({
  pinId: z.string().uuid(),
  section: z.enum(policySections),
  sourceId: z.string().trim().min(1).max(160),
  revision: z.string().trim().min(1).max(80),
  sha256,
}).strict();

const applicabilitySchema = z.object({
  vehicleModelId: boundedReference,
  systemId: boundedReference,
  taskClassId: boundedReference,
}).strict();

const sectionSchema = z.object({
  sourcePinIds: z.array(z.string().uuid()).min(1),
  ruleSetId: z.string().trim().min(1).max(160),
}).strict();

export const workOrderPolicyPackageSchema = z.object({
  packageId: z.string().uuid(),
  revision: z.number().int().positive(),
  schemaVersion: z.literal(1),
  effectiveFrom: z.string().datetime({ offset: true }),
  effectiveTo: z.string().datetime({ offset: true }).nullable(),
  sourcePins: z.array(sourcePinSchema).min(1),
  applicability: z.array(applicabilitySchema).min(1),
  sections: z.object({
    scope: sectionSchema,
    execution: sectionSchema,
    hse: sectionSchema,
    inspection: sectionSchema,
    faultDisposition: sectionSchema,
    release: sectionSchema,
  }).strict(),
}).strict().superRefine((value, ctx) => {
  const pinIds = new Set(value.sourcePins.map(pin => pin.pinId));
  if (pinIds.size !== value.sourcePins.length) {
    ctx.addIssue({ code: 'custom', path: ['sourcePins'], message: 'Source pins must be unique.' });
  }
  for (const section of policySections) {
    const refs = value.sections[section].sourcePinIds;
    if (!refs.length || new Set(refs).size !== refs.length) {
      ctx.addIssue({ code: 'custom', path: ['sections', section, 'sourcePinIds'], message: 'Each section needs unique source pins.' });
    }
    for (const ref of refs) {
      if (!value.sourcePins.some(pin => pin.section === section && pin.pinId === ref)) {
        ctx.addIssue({ code: 'custom', path: ['sections', section, 'sourcePinIds'], message: `Section ${section} references an unknown source pin.` });
      }
    }
  }
  if (value.effectiveTo && Date.parse(value.effectiveTo) <= Date.parse(value.effectiveFrom)) {
    ctx.addIssue({ code: 'custom', path: ['effectiveTo'], message: 'The end time must be after the start time.' });
  }
  const applicabilityKeys = value.applicability.map(item => `${item.vehicleModelId}\0${item.systemId}\0${item.taskClassId}`);
  if (new Set(applicabilityKeys).size !== applicabilityKeys.length) {
    ctx.addIssue({ code: 'custom', path: ['applicability'], message: 'Applicability entries must be unique.' });
  }
});

export type WorkOrderPolicyPackage = z.infer<typeof workOrderPolicyPackageSchema>;
export type ImmutableWorkOrderPolicyPackage<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly unknown[]
    ? { readonly [K in keyof T]: ImmutableWorkOrderPolicyPackage<T[K]> }
    : T extends object
      ? { readonly [K in keyof T]: ImmutableWorkOrderPolicyPackage<T[K]> }
      : T;

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function digestWorkOrderPolicyPackage(input: unknown): { package: ImmutableWorkOrderPolicyPackage<WorkOrderPolicyPackage>; sha256: string } {
  const parsed = workOrderPolicyPackageSchema.parse(input);
  const sha256 = createHash('sha256').update(canonical(parsed)).digest('hex');
  return { package: deepFreeze(parsed), sha256 };
}

export type PolicyResolution = { available: false; code: 'POLICY_UNAVAILABLE'; reason: string };

/** Validate a candidate only. An authenticated approval/effectivity decision is still required to use it. */
export function validateEffectivePolicyCandidate(
  input: unknown,
  expectedDigest: string,
  now: Date,
): PolicyResolution {
  const parsed = workOrderPolicyPackageSchema.safeParse(input);
  if (!parsed.success) return { available: false, code: 'POLICY_UNAVAILABLE', reason: 'The policy package is incomplete or invalid.' };
  const actual = createHash('sha256').update(canonical(parsed.data)).digest('hex');
  if (!sha256.safeParse(expectedDigest).success || actual !== expectedDigest) {
    return { available: false, code: 'POLICY_UNAVAILABLE', reason: 'The policy package digest does not match.' };
  }
  const instant = now.getTime();
  if (!Number.isFinite(instant) || Date.parse(parsed.data.effectiveFrom) > instant ||
      (parsed.data.effectiveTo !== null && Date.parse(parsed.data.effectiveTo) <= instant)) {
    return { available: false, code: 'POLICY_UNAVAILABLE', reason: 'The policy package is not effective now.' };
  }
  // No approval ledger/resolver exists in this phase, so no candidate is operationally effective.
  return { available: false, code: 'POLICY_UNAVAILABLE', reason: 'No approved effective policy package is available.' };
}
