import { z } from 'zod';

export const vehicleLearningSystemDefinitions = [
  { key: 'hv-traction-battery', label: 'HV traction battery pack', group: 'Energy storage and control' },
  { key: 'battery-management-system', label: 'Battery Management System (BMS)', group: 'Energy storage and control' },
  { key: '12v-battery', label: '12V battery', group: 'Energy storage and control' },
  { key: 'power-distribution-box', label: 'Power distribution / junction box', group: 'Energy storage and control' },
  { key: 'battery-sensing', label: 'Battery current/voltage sensing', group: 'Energy storage and control' },
  { key: 'front-traction-motor', label: 'Front traction motor', group: 'Traction and power electronics' },
  { key: 'rear-traction-motor', label: 'Rear traction motor', group: 'Traction and power electronics' },
  { key: 'inverter-motor-controller', label: 'Inverter / motor controller', group: 'Traction and power electronics' },
  { key: 'reduction-gearbox-differential', label: 'Reduction gearbox / differential', group: 'Traction and power electronics' },
  { key: 'dc-dc-converter', label: 'DC/DC converter', group: 'Traction and power electronics' },
  { key: 'onboard-charger', label: 'Onboard charger (OBC)', group: 'Traction and power electronics' },
  { key: 'charging-inlet', label: 'Charging inlet / plug format', group: 'Charging' },
  { key: 'ac-charging-detection', label: 'AC charging pilot / connector detection', group: 'Charging' },
  { key: 'dc-charging-control', label: 'DC charging control / lock', group: 'Charging' },
  { key: 'battery-coolant', label: 'Battery coolant system', group: 'Thermal and auxiliary' },
  { key: 'electric-cooling-pumps-valves', label: 'Electric cooling pumps/valves', group: 'Thermal and auxiliary' },
  { key: 'electric-ac-compressor', label: 'Electric A/C compressor', group: 'Thermal and auxiliary' },
  { key: 'heat-pump-ptc-heater', label: 'Heat pump / PTC heater', group: 'Thermal and auxiliary' },
  { key: 'cabin-ventilation-filters', label: 'Cabin ventilation and filters', group: 'Thermal and auxiliary' },
  { key: 'high-voltage-harness', label: 'High-voltage harness / warnings', group: 'Safety and control' },
  { key: 'high-voltage-interlock', label: 'HV interlock (HVIL) system', group: 'Safety and control' },
  { key: 'insulation-monitoring', label: 'Insulation monitoring', group: 'Safety and control' },
  { key: 'vehicle-control-modules', label: 'Vehicle control / zonal modules', group: 'Safety and control' },
  { key: 'brakes-regenerative-braking', label: 'Brakes / regenerative braking', group: 'Safety and control' },
  { key: 'peps-digital-key', label: 'PEPS / digital key', group: 'Safety and control' },
  { key: 'adas-sensors', label: 'ADAS camera / radar / ultrasonic sensors', group: 'Safety and control' },
] as const;

export const vehicleLearningSystemKeySchema = z.enum(vehicleLearningSystemDefinitions.map(item => item.key) as [string, ...string[]]);
export const vehicleLearningQuestionIds = [
  'power-source', 'traction-motor-count', 'driven-axles', 'engine-role',
  'charging-and-connector', 'battery-voltage-platform', 'controllers-and-modules', 'documentation-needed',
] as const;
export const vehicleLearningQuestionSchema = z.enum(vehicleLearningQuestionIds);

export const evidenceCitationSchema = z.object({
  kind: z.enum(['visual', 'label-vin', 'oem-document', 'vehicle-interface', 'diagnostic-data']),
  sourceTitle: z.string().trim().max(180),
  revisionOrDate: z.string().trim().max(120),
  pageOrSection: z.string().trim().max(120),
}).strict();

const confidenceSchema = z.enum(['low', 'medium', 'high', 'not-assessed']);
const claimStateSchema = z.enum([
  'hypothesis', 'observed', 'documentary-confirmed', 'diagnostic-confirmed', 'unknown', 'not-applicable',
]);

const learningFindingBaseSchema = z.object({
  state: claimStateSchema,
  answer: z.string().trim().max(1200),
  confidence: confidenceSchema,
  citations: z.array(evidenceCitationSchema).max(8),
  uncertainty: z.string().trim().max(1200),
}).strict();

function validateFindingEvidence(finding: z.infer<typeof learningFindingBaseSchema>, context: z.RefinementCtx) {
  const hasCompleteSource = (kinds: string[]) => finding.citations.some(citation =>
    kinds.includes(citation.kind) && citation.sourceTitle.trim() && citation.revisionOrDate.trim() && citation.pageOrSection.trim());
  if (finding.state === 'observed' && !hasCompleteSource(['visual'])) {
    context.addIssue({ code: 'custom', path: ['citations'], message: 'An observation needs a visual source.' });
  }
  if (finding.state === 'documentary-confirmed'
    && !hasCompleteSource(['label-vin', 'oem-document', 'vehicle-interface'])) {
    context.addIssue({ code: 'custom', path: ['citations'], message: 'Document-confirmed information needs a label, approved document or vehicle-interface source.' });
  }
  if (finding.state === 'diagnostic-confirmed' && !hasCompleteSource(['diagnostic-data'])) {
    context.addIssue({ code: 'custom', path: ['citations'], message: 'Diagnostic-confirmed information needs a diagnostic-data source.' });
  }
  if (finding.state === 'not-applicable' && !finding.uncertainty) {
    context.addIssue({ code: 'custom', path: ['uncertainty'], message: 'Explain why this does not apply.' });
  }
}

export const learningFindingSchema = learningFindingBaseSchema.superRefine(validateFindingEvidence);

const vehicleClassSchema = z.enum(['BEV', 'PHEV', 'HEV', 'EREV', 'REEV', 'ICE', 'unknown']);
const drivetrainSchema = z.enum(['FWD', 'RWD', 'AWD', 'unknown']);
const preliminaryFindingSchema = learningFindingBaseSchema.extend({
  answer: vehicleClassSchema,
  state: z.enum(['hypothesis', 'unknown']),
}).superRefine(validateFindingEvidence);
const preliminaryDrivetrainSchema = learningFindingBaseSchema.extend({
  answer: drivetrainSchema,
  state: z.enum(['hypothesis', 'unknown']),
}).superRefine(validateFindingEvidence);

const technicalQuestionShape = Object.fromEntries(vehicleLearningQuestionIds.map(id => [id, learningFindingSchema])) as Record<typeof vehicleLearningQuestionIds[number], typeof learningFindingSchema>;
const systemAssessmentSchema = z.object({
  state: z.enum(['observed', 'documentary-confirmed', 'diagnostic-confirmed', 'unknown', 'not-applicable']),
  nonInvasiveLocationOrSource: z.string().trim().max(1000),
  notes: z.string().trim().max(1200),
  confidence: confidenceSchema,
  citations: z.array(evidenceCitationSchema).max(8),
  uncertainty: z.string().trim().max(1200),
}).strict().superRefine((finding, context) => {
  const hasCompleteSource = (kinds: string[]) => finding.citations.some(citation =>
    kinds.includes(citation.kind) && citation.sourceTitle.trim() && citation.revisionOrDate.trim() && citation.pageOrSection.trim());
  if (finding.state === 'observed' && !hasCompleteSource(['visual'])) {
    context.addIssue({ code: 'custom', path: ['citations'], message: 'An observed system needs a visual source.' });
  }
  if (finding.state === 'documentary-confirmed'
    && !hasCompleteSource(['label-vin', 'oem-document', 'vehicle-interface'])) {
    context.addIssue({ code: 'custom', path: ['citations'], message: 'Document-confirmed systems need a label, approved document or vehicle-interface source.' });
  }
  if (finding.state === 'diagnostic-confirmed' && !hasCompleteSource(['diagnostic-data'])) {
    context.addIssue({ code: 'custom', path: ['citations'], message: 'Diagnostic-confirmed systems need a diagnostic-data source.' });
  }
  if (finding.state === 'not-applicable' && !finding.uncertainty) {
    context.addIssue({ code: 'custom', path: ['uncertainty'], message: 'Explain why this system does not apply.' });
  }
});

const energyPathSchema = z.object({
  applicability: z.enum(['present', 'not-fitted', 'unknown']),
  explanation: z.string().trim().max(2000),
  citations: z.array(evidenceCitationSchema).max(8),
  unknowns: z.string().trim().max(1000),
}).strict().superRefine((path, context) => {
  if (path.applicability === 'not-fitted' && !path.unknowns) {
    context.addIssue({ code: 'custom', path: ['unknowns'], message: 'Explain the evidence for marking this path not fitted.' });
  }
});

export const vehicleLearningAssessmentSchema = z.object({
  schemaVersion: z.literal(1),
  preliminary: z.object({
    bodyStyleAndApproximateSize: z.string().trim().max(500),
    visibleClues: z.tuple([z.string().trim().max(300), z.string().trim().max(300)]),
    vehicleType: preliminaryFindingSchema,
    drivetrain: preliminaryDrivetrainSchema,
    assumptions: z.string().trim().max(1200),
  }).strict(),
  technicalFindings: z.object(technicalQuestionShape).strict(),
  systems: z.record(vehicleLearningSystemKeySchema, systemAssessmentSchema),
  energyPaths: z.object({
    driving: energyPathSchema,
    acCharging: energyPathSchema,
    dcCharging: energyPathSchema,
    regenerativeBraking: energyPathSchema,
  }).strict(),
  explanations: z.object({
    inverterDcDcAndOnboardCharger: z.string().trim().max(2000),
    phevVersusErev: z.string().trim().max(2000),
    evidenceForDrivenAxles: z.string().trim().max(2000),
    safelyVerifyingHiddenSystems: z.string().trim().max(2000),
  }).strict(),
  learnerQuestions: z.string().trim().max(2000),
  legacy: z.object({
    originalPowertrain: z.string().max(40),
    originalDrivetrain: z.string().max(40),
    originalSystems: z.array(z.string().max(80)).max(20),
    originalEvidence: z.string().max(4000),
    originalQuestions: z.string().max(2000),
  }).strict().nullable(),
}).strict().superRefine((assessment, context) => {
  if (Object.keys(assessment.systems).length !== vehicleLearningSystemDefinitions.length) {
    context.addIssue({ code: 'custom', path: ['systems'], message: 'Include a status for every system in the source register.' });
  }
  for (const definition of vehicleLearningSystemDefinitions) {
    if (!assessment.systems[definition.key]) {
      context.addIssue({ code: 'custom', path: ['systems', definition.key], message: 'System status is required; use unknown if it has not been checked.' });
    }
  }
});

export type VehicleLearningAssessment = z.infer<typeof vehicleLearningAssessmentSchema>;

function emptyFinding(answer = ''): VehicleLearningAssessment['technicalFindings'][typeof vehicleLearningQuestionIds[number]] {
  return { state: 'unknown', answer, confidence: 'not-assessed', citations: [], uncertainty: '' };
}

export function createVehicleLearningAssessment(): VehicleLearningAssessment {
  return vehicleLearningAssessmentSchema.parse({
    schemaVersion: 1,
    preliminary: {
      bodyStyleAndApproximateSize: '',
      visibleClues: ['', ''],
      vehicleType: { ...emptyFinding('unknown'), answer: 'unknown' },
      drivetrain: { ...emptyFinding('unknown'), answer: 'unknown' },
      assumptions: '',
    },
    technicalFindings: Object.fromEntries(vehicleLearningQuestionIds.map(id => [id, emptyFinding()])),
    systems: Object.fromEntries(vehicleLearningSystemDefinitions.map(item => [item.key, {
      state: 'unknown', nonInvasiveLocationOrSource: '', notes: '', confidence: 'not-assessed', citations: [], uncertainty: '',
    }])),
    energyPaths: {
      driving: { applicability: 'unknown', explanation: '', citations: [], unknowns: '' },
      acCharging: { applicability: 'unknown', explanation: '', citations: [], unknowns: '' },
      dcCharging: { applicability: 'unknown', explanation: '', citations: [], unknowns: '' },
      regenerativeBraking: { applicability: 'unknown', explanation: '', citations: [], unknowns: '' },
    },
    explanations: {
      inverterDcDcAndOnboardCharger: '', phevVersusErev: '', evidenceForDrivenAxles: '', safelyVerifyingHiddenSystems: '',
    },
    learnerQuestions: '',
    legacy: null,
  });
}

function defaultSystemAssessment() {
  return {
    state: 'unknown' as const,
    nonInvasiveLocationOrSource: '',
    notes: '',
    confidence: 'not-assessed' as const,
    citations: [],
    uncertainty: '',
  };
}

function legacyFinding(answer: string, kind: 'vehicle' | 'drivetrain'): z.infer<typeof learningFindingSchema> {
  const vehicleValue = ['BEV', 'PHEV', 'HEV', 'EREV', 'REEV', 'ICE'].includes(answer) ? answer as VehicleLearningAssessment['preliminary']['vehicleType']['answer'] : 'unknown';
  const drivetrainValue = answer === 'AWD/4WD' ? 'AWD' : ['FWD', 'RWD', 'AWD'].includes(answer) ? answer as VehicleLearningAssessment['preliminary']['drivetrain']['answer'] : 'unknown';
  const value = kind === 'vehicle' ? vehicleValue : drivetrainValue;
  const ambiguous = answer === 'EREV/REEV' || answer === 'AWD/4WD';
  return {
    ...emptyFinding(value),
    state: value !== 'unknown' && !ambiguous ? 'hypothesis' : 'unknown',
    uncertainty: ambiguous ? `The earlier form grouped ${answer}; it did not record which option was intended.`
      : answer && answer !== 'unknown' ? 'Earlier form did not record evidence or confirmation status.' : '',
  };
}

export function assessmentFromLegacy(row: {
  powertrain: string;
  drivetrain: string;
  systems: string[];
  evidence: string;
  questions: string;
}): VehicleLearningAssessment {
  const assessment = createVehicleLearningAssessment();
  const selected = new Set(row.systems);
  for (const definition of vehicleLearningSystemDefinitions) {
    if (selected.has(definition.label)) assessment.systems[definition.key] = {
      ...defaultSystemAssessment(),
      notes: 'Selected as a study topic in the earlier form; no result or evidence status was recorded.',
    };
  }
  return vehicleLearningAssessmentSchema.parse({
    ...assessment,
    preliminary: {
      ...assessment.preliminary,
      vehicleType: legacyFinding(row.powertrain, 'vehicle'),
      drivetrain: legacyFinding(row.drivetrain, 'drivetrain'),
    },
    legacy: {
      originalPowertrain: row.powertrain,
      originalDrivetrain: row.drivetrain,
      originalSystems: row.systems,
      originalEvidence: row.evidence,
      originalQuestions: row.questions,
    },
  });
}

function projectedType(assessment: VehicleLearningAssessment) {
  const value = assessment.preliminary.vehicleType.answer;
  return value === 'EREV' || value === 'REEV' ? 'EREV/REEV' : value;
}

export function projectAssessment(assessment: VehicleLearningAssessment) {
  const evidence = [
    ...assessment.preliminary.vehicleType.citations,
    ...assessment.preliminary.drivetrain.citations,
    ...Object.values(assessment.technicalFindings).flatMap(finding => finding.citations),
    ...Object.values(assessment.systems).flatMap(finding => finding.citations),
  ].map(source => `${source.sourceTitle}${source.revisionOrDate ? ` (${source.revisionOrDate})` : ''}${source.pageOrSection ? `, ${source.pageOrSection}` : ''}`);
  const uniqueEvidence = [...new Set(evidence)];
  return {
    powertrain: projectedType(assessment),
    drivetrain: assessment.preliminary.drivetrain.answer === 'AWD' ? 'AWD/4WD' : assessment.preliminary.drivetrain.answer,
    systems: vehicleLearningSystemDefinitions.filter(item => assessment.systems[item.key]?.state !== 'unknown').map(item => item.label),
    evidence: assessment.legacy?.originalEvidence ?? (uniqueEvidence.join('; ').slice(0, 4000) || 'Structured learning assessment; unknown answers remain unconfirmed.'),
    questions: assessment.learnerQuestions || assessment.legacy?.originalQuestions || '',
  };
}
