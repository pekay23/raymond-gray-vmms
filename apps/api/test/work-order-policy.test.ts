import assert from 'node:assert/strict';
import test from 'node:test';
import { digestWorkOrderPolicyPackage, policySections, validateEffectivePolicyCandidate } from '../src/work-order-policy.js';

function fixture() {
  const sourcePins = policySections.map((section, index) => ({
    pinId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    section,
    sourceId: `synthetic-${section}`,
    revision: 'fixture-1',
    sha256: 'a'.repeat(64),
  }));
  const sections = Object.fromEntries(policySections.map((section, index) => [section, {
    sourcePinIds: [sourcePins[index]!.pinId], ruleSetId: `synthetic-rules-${section}`,
  }]));
  return {
    packageId: 'd3ea0602-867a-4a47-b84c-b02b03273003', revision: 1, schemaVersion: 1,
    effectiveFrom: '2026-01-01T00:00:00Z', effectiveTo: null,
    sourcePins, applicability: [{ vehicleModelId: 'synthetic-model', systemId: 'synthetic-system', taskClassId: 'synthetic-task' }], sections,
  };
}

test('policy package is strict, complete, and deterministically digested', () => {
  const first = digestWorkOrderPolicyPackage(fixture());
  const reordered = Object.fromEntries(Object.entries(fixture()).reverse());
  const second = digestWorkOrderPolicyPackage(reordered);
  assert.equal(first.sha256, second.sha256, 'canonical digest should ignore object key order');
  assert.equal(first.package.schemaVersion, 1);
  assert.throws(() => digestWorkOrderPolicyPackage({ ...fixture(), unexpected: true }));
  assert.throws(() => (first.package as unknown as { revision: number }).revision = 2, TypeError);
});

test('missing section source references and duplicate applicability are rejected', () => {
  const emptyScope = fixture();
  emptyScope.sections.scope!.sourcePinIds = [];
  assert.throws(() => digestWorkOrderPolicyPackage(emptyScope));
  const dangling = fixture();
  dangling.sections.release!.sourcePinIds = ['00000000-0000-4000-8000-000000000000'];
  assert.throws(() => digestWorkOrderPolicyPackage(dangling));
  const duplicate = fixture();
  duplicate.applicability.push(duplicate.applicability[0]!);
  assert.throws(() => digestWorkOrderPolicyPackage(duplicate));
  const duplicatePin = fixture();
  duplicatePin.sourcePins.push(duplicatePin.sourcePins[0]!);
  assert.throws(() => digestWorkOrderPolicyPackage(duplicatePin));
  assert.throws(() => digestWorkOrderPolicyPackage({ ...fixture(), effectiveTo: '2026-01-01T00:00:00Z' }));
  assert.throws(() => digestWorkOrderPolicyPackage({ ...fixture(), applicability: [{ vehicleModelId: '*', systemId: 'synthetic-system', taskClassId: 'synthetic-task' }] }));
});

test('valid synthetic package candidates remain unavailable without approved policy authority', () => {
  const candidate = digestWorkOrderPolicyPackage(fixture());
  const result = validateEffectivePolicyCandidate(candidate.package, candidate.sha256, new Date('2026-11-09T12:00:00Z'));
  assert.deepEqual(result, {
    available: false,
    code: 'POLICY_UNAVAILABLE',
    reason: 'No approved effective policy package is available.',
  });
});

test('bad digest, expired and future packages deny with a clear unavailable result', () => {
  const candidate = digestWorkOrderPolicyPackage(fixture());
  assert.equal(validateEffectivePolicyCandidate(candidate.package, '0'.repeat(64), new Date('2026-11-09')).reason, 'The policy package digest does not match.');
  const expired = digestWorkOrderPolicyPackage({ ...fixture(), effectiveTo: '2026-11-08T00:00:00Z' });
  assert.equal(validateEffectivePolicyCandidate(expired.package, expired.sha256, new Date('2026-11-09')).reason, 'The policy package is not effective now.');
  const future = digestWorkOrderPolicyPackage({ ...fixture(), effectiveFrom: '2026-12-01T00:00:00Z' });
  assert.equal(validateEffectivePolicyCandidate(future.package, future.sha256, new Date('2026-11-09')).reason, 'The policy package is not effective now.');
  assert.equal(validateEffectivePolicyCandidate({ ...candidate.package, schemaVersion: 2 }, candidate.sha256, new Date('2026-11-09')).reason, 'The policy package is incomplete or invalid.');
});

test('effectivity interval includes its exact start but excludes its exact end', () => {
  const candidate = digestWorkOrderPolicyPackage({ ...fixture(), effectiveTo: '2026-11-10T00:00:00Z' });
  assert.equal(validateEffectivePolicyCandidate(candidate.package, candidate.sha256, new Date('2026-01-01T00:00:00Z')).reason, 'No approved effective policy package is available.');
  assert.equal(validateEffectivePolicyCandidate(candidate.package, candidate.sha256, new Date('2026-11-10T00:00:00Z')).reason, 'The policy package is not effective now.');
  assert.equal(validateEffectivePolicyCandidate(candidate.package, candidate.sha256, new Date(Number.NaN)).reason, 'The policy package is not effective now.');
});
