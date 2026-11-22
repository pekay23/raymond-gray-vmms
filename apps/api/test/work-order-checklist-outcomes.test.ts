import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError } from '../src/errors.js';
import { checklistOutcomeInputSchema, validateOutcomeAgainstItemRules } from '../src/work-order-checklist-outcomes.js';

const baseInput = checklistOutcomeInputSchema.parse({
  expectedChecklistVersion: 1,
  expectedWorkPlanRevisionId: '10000000-0000-4000-8000-000000000001',
  expectedAssignmentRevision: 1,
  result: 'completed',
  reason: null,
  applicabilityReason: null,
  comments: null,
  measurement: null,
  evidenceIds: [],
  supersedesRevisionId: null,
  correctionReason: null,
});

const minimumRules = {
  id: 'BRAKE-CHECK',
  classification: { systemCode: 'CHASSIS.BRAKES', taskClassCode: 'INSPECTION.ROUTINE' },
  requiredQualifications: ['EV-MAINTENANCE'],
};

function assertRuleError(run: () => unknown, code: string) {
  assert.throws(run, (error: unknown) => error instanceof ApiError && error.code === code);
}

test('checklist outcome accepts a completed item with its qualification rule', () => {
  assert.deepEqual(validateOutcomeAgainstItemRules(baseInput, minimumRules), minimumRules);
});

test('checklist outcome refuses a rule without a required qualification', () => {
  assertRuleError(
    () => validateOutcomeAgainstItemRules(baseInput, { id: 'BRAKE-CHECK', requiredQualifications: [] }),
    'CHECKLIST_MODEL_RULES_INCOMPLETE',
  );
});

test('checklist outcome refuses a rule without source-bound system and task classification', () => {
  assertRuleError(
    () => validateOutcomeAgainstItemRules(baseInput, { id: 'BRAKE-CHECK', requiredQualifications: ['EV-MAINTENANCE'] }),
    'CHECKLIST_MODEL_RULES_INCOMPLETE',
  );
});

test('checklist outcome requires accepted evidence references when the source requires evidence', () => {
  assertRuleError(
    () => validateOutcomeAgainstItemRules(baseInput, { ...minimumRules, evidenceRequired: true }),
    'CHECKLIST_EVIDENCE_REQUIRED',
  );
});

test('checklist outcome does not allow not-applicable unless the source permits it', () => {
  const input = checklistOutcomeInputSchema.parse({ ...baseInput, result: 'not-applicable', reason: 'Not fitted', applicabilityReason: 'Vehicle configuration does not include this feature.' });
  assertRuleError(() => validateOutcomeAgainstItemRules(input, minimumRules), 'CHECKLIST_NOT_APPLICABLE_NOT_ALLOWED');
});

test('checklist outcome requires the exact prescribed measurement and unit', () => {
  const rules = { ...minimumRules, measurementRule: { field: 'tyre-tread', unit: 'mm', required: true } };
  assertRuleError(() => validateOutcomeAgainstItemRules(baseInput, rules), 'CHECKLIST_MEASUREMENT_REQUIRED');

  const input = checklistOutcomeInputSchema.parse({ ...baseInput, measurement: { field: 'tyre-tread', value: '4.2', unit: 'cm' } });
  assertRuleError(() => validateOutcomeAgainstItemRules(input, rules), 'CHECKLIST_MEASUREMENT_NOT_PRESCRIBED');
});
