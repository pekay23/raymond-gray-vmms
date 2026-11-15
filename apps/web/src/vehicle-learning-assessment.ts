import { z } from 'zod';

type LearningSystemItem = readonly [key: string, label: string];
type LearningSystemGroup = { title: string; items: readonly LearningSystemItem[] };

export const learningSystemGroups: LearningSystemGroup[] = [
  { title: 'Energy storage and control', items: [
    ['hv-traction-battery', 'HV traction battery pack'], ['battery-management-system', 'Battery Management System (BMS)'],
    ['12v-battery', '12V battery'], ['power-distribution-box', 'Power distribution / junction box'], ['battery-sensing', 'Battery current/voltage sensing'],
  ] },
  { title: 'Traction and power electronics', items: [
    ['front-traction-motor', 'Front traction motor'], ['rear-traction-motor', 'Rear traction motor'],
    ['inverter-motor-controller', 'Inverter / motor controller'], ['reduction-gearbox-differential', 'Reduction gearbox / differential'],
    ['dc-dc-converter', 'DC/DC converter'], ['onboard-charger', 'Onboard charger (OBC)'],
  ] },
  { title: 'Charging', items: [
    ['charging-inlet', 'Charging inlet / plug format'], ['ac-charging-detection', 'AC charging pilot / connector detection'],
    ['dc-charging-control', 'DC charging control / lock'],
  ] },
  { title: 'Thermal and auxiliary', items: [
    ['battery-coolant', 'Battery coolant system'], ['electric-cooling-pumps-valves', 'Electric cooling pumps/valves'],
    ['electric-ac-compressor', 'Electric A/C compressor'], ['heat-pump-ptc-heater', 'Heat pump / PTC heater'],
    ['cabin-ventilation-filters', 'Cabin ventilation and filters'],
  ] },
  { title: 'Safety and control', items: [
    ['high-voltage-harness', 'High-voltage harness / warnings'], ['high-voltage-interlock', 'HV interlock (HVIL) system'],
    ['insulation-monitoring', 'Insulation monitoring'], ['vehicle-control-modules', 'Vehicle control / zonal modules'],
    ['brakes-regenerative-braking', 'Brakes / regenerative braking'], ['peps-digital-key', 'PEPS / digital key'],
    ['adas-sensors', 'ADAS camera / radar / ultrasonic sensors'],
  ] },
];

export const learningSystemItems = learningSystemGroups.flatMap(group => group.items);
export const learningQuestionItems = [
  ['power-source', 'Is the power source battery-electric, combustion, or mixed?'],
  ['traction-motor-count', 'How many electric traction motors are identified?'],
  ['driven-axles', 'Which axle or axles receive drive?'],
  ['engine-role', 'Does an engine drive the wheels, generate power, or both?'],
  ['charging-and-connector', 'What AC/DC charging and connector types are supported?'],
  ['battery-voltage-platform', 'What battery voltage or platform is documented?'],
  ['controllers-and-modules', 'Which control or diagnostic modules are identified?'],
  ['documentation-needed', 'What remains to be checked in service documentation?'],
] as const;

const citation = z.object({
  kind: z.enum(['visual', 'label-vin', 'oem-document', 'vehicle-interface', 'diagnostic-data']),
  sourceTitle: z.string(), revisionOrDate: z.string(), pageOrSection: z.string(),
}).strict();
const finding = z.object({
  state: z.enum(['hypothesis', 'observed', 'documentary-confirmed', 'diagnostic-confirmed', 'unknown', 'not-applicable']),
  answer: z.string(), confidence: z.enum(['low', 'medium', 'high', 'not-assessed']),
  citations: z.array(citation), uncertainty: z.string(),
}).strict();
const systemAnswer = z.object({
  state: z.enum(['observed', 'documentary-confirmed', 'diagnostic-confirmed', 'unknown', 'not-applicable']),
  nonInvasiveLocationOrSource: z.string(), notes: z.string(), confidence: z.enum(['low', 'medium', 'high', 'not-assessed']),
  citations: z.array(citation), uncertainty: z.string(),
}).strict();
const energyPath = z.object({
  applicability: z.enum(['present', 'not-fitted', 'unknown']), explanation: z.string(),
  citations: z.array(citation), unknowns: z.string(),
}).strict();
const questionIds = learningQuestionItems.map(([id]) => id) as [string, ...string[]];
const systemIds = learningSystemItems.map(([id]) => id) as [string, ...string[]];

export const vehicleLearningAssessmentSchema = z.object({
  schemaVersion: z.literal(1),
  preliminary: z.object({
    bodyStyleAndApproximateSize: z.string(),
    visibleClues: z.tuple([z.string(), z.string()]),
    vehicleType: finding.extend({ state: z.enum(['hypothesis', 'unknown']), answer: z.enum(['BEV', 'PHEV', 'HEV', 'EREV', 'REEV', 'ICE', 'unknown']) }),
    drivetrain: finding.extend({ state: z.enum(['hypothesis', 'unknown']), answer: z.enum(['FWD', 'RWD', 'AWD', 'unknown']) }),
    assumptions: z.string(),
  }).strict(),
  technicalFindings: z.record(z.enum(questionIds), finding),
  systems: z.record(z.enum(systemIds), systemAnswer),
  energyPaths: z.object({ driving: energyPath, acCharging: energyPath, dcCharging: energyPath, regenerativeBraking: energyPath }).strict(),
  explanations: z.object({
    inverterDcDcAndOnboardCharger: z.string(), phevVersusErev: z.string(),
    evidenceForDrivenAxles: z.string(), safelyVerifyingHiddenSystems: z.string(),
  }).strict(),
  learnerQuestions: z.string(),
  legacy: z.object({
    originalPowertrain: z.string(), originalDrivetrain: z.string(), originalSystems: z.array(z.string()),
    originalEvidence: z.string(), originalQuestions: z.string(),
  }).strict().nullable(),
}).strict();

export type VehicleLearningAssessment = z.infer<typeof vehicleLearningAssessmentSchema>;
export type AssessmentFinding = NonNullable<VehicleLearningAssessment['technicalFindings'][string]>;
export type SystemAssessment = NonNullable<VehicleLearningAssessment['systems'][string]>;

const emptyFinding = (answer = ''): AssessmentFinding => ({
  state: 'unknown', answer, confidence: 'not-assessed', citations: [], uncertainty: '',
});
const emptySystem = (): SystemAssessment => ({
  state: 'unknown', nonInvasiveLocationOrSource: '', notes: '', confidence: 'not-assessed', citations: [], uncertainty: '',
});
const emptyEnergyPath = () => ({ applicability: 'unknown' as const, explanation: '', citations: [], unknowns: '' });

export function createVehicleLearningAssessment(): VehicleLearningAssessment {
  return vehicleLearningAssessmentSchema.parse({
    schemaVersion: 1,
    preliminary: {
      bodyStyleAndApproximateSize: '', visibleClues: ['', ''],
      vehicleType: { ...emptyFinding('unknown'), answer: 'unknown' },
      drivetrain: { ...emptyFinding('unknown'), answer: 'unknown' }, assumptions: '',
    },
    technicalFindings: Object.fromEntries(learningQuestionItems.map(([id]) => [id, emptyFinding()])),
    systems: Object.fromEntries(learningSystemItems.map(([id]) => [id, emptySystem()])),
    energyPaths: {
      driving: emptyEnergyPath(), acCharging: emptyEnergyPath(), dcCharging: emptyEnergyPath(), regenerativeBraking: emptyEnergyPath(),
    },
    explanations: {
      inverterDcDcAndOnboardCharger: '', phevVersusErev: '', evidenceForDrivenAxles: '', safelyVerifyingHiddenSystems: '',
    },
    learnerQuestions: '', legacy: null,
  });
}

export const evidenceKindLabels = [
  ['visual', 'Visual observation'], ['label-vin', 'Label or VIN documentation'], ['oem-document', 'Approved OEM document'],
  ['vehicle-interface', 'Vehicle screen or interface'], ['diagnostic-data', 'Approved diagnostic data'],
] as const;

export const findingStateLabels = [
  ['hypothesis', 'First guess'], ['observed', 'Observed'], ['documentary-confirmed', 'Confirmed from document'],
  ['diagnostic-confirmed', 'Confirmed from diagnostic data'], ['unknown', 'Unknown'], ['not-applicable', 'Not applicable'],
] as const;
