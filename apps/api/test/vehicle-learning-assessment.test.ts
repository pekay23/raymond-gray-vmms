import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assessmentFromLegacy,
  createVehicleLearningAssessment,
  vehicleLearningAssessmentSchema,
  vehicleLearningSystemDefinitions,
} from '../src/vehicle-learning-assessment.js';

test('vehicle learning assessment starts with every source-register system explicitly unknown', () => {
  const assessment = createVehicleLearningAssessment();
  assert.equal(Object.keys(assessment.systems).length, vehicleLearningSystemDefinitions.length);
  assert(vehicleLearningSystemDefinitions.every(system => assessment.systems[system.key]?.state === 'unknown'));
  assert.equal(assessment.preliminary.vehicleType.state, 'unknown');
  assert.equal(assessment.preliminary.drivetrain.state, 'unknown');
});

test('vehicle learning assessment rejects unsupported confirmed evidence and missing not-applicable reasons', () => {
  const assessment = createVehicleLearningAssessment();
  assessment.technicalFindings['driven-axles'] = {
    state: 'diagnostic-confirmed', answer: 'Rear axle', confidence: 'high', citations: [], uncertainty: '',
  };
  assert.equal(vehicleLearningAssessmentSchema.safeParse(assessment).success, false);

  assessment.technicalFindings['driven-axles'] = {
    state: 'not-applicable', answer: '', confidence: 'not-assessed', citations: [], uncertainty: '',
  };
  assert.equal(vehicleLearningAssessmentSchema.safeParse(assessment).success, false);
});

test('legacy learning values are preserved as unconfirmed notes', () => {
  const assessment = assessmentFromLegacy({
    powertrain: 'EREV/REEV',
    drivetrain: 'AWD/4WD',
    systems: ['HV traction battery pack'],
    evidence: 'Earlier free-text evidence.',
    questions: 'Earlier question.',
  });
  assert.equal(assessment.legacy?.originalEvidence, 'Earlier free-text evidence.');
  assert.equal(assessment.legacy?.originalQuestions, 'Earlier question.');
  assert.equal(assessment.preliminary.vehicleType.state, 'unknown');
  assert.match(assessment.preliminary.vehicleType.uncertainty, /grouped EREV\/REEV/);
  assert.equal(assessment.preliminary.drivetrain.state, 'unknown');
  assert.equal(assessment.systems['hv-traction-battery']!.state, 'unknown');
  assert.match(assessment.systems['hv-traction-battery']!.notes, /no result or evidence status/);
});
