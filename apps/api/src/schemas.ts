import { z } from 'zod';
import { uuid } from './db.js';

const wording = z.string().trim().min(1).max(4000);
const short = z.string().trim().min(1).max(160);
const expectedVersion = z.number().int().positive();
const at = z.union([z.date(),z.iso.datetime({offset:true})]).transform(v => v instanceof Date ? v.toISOString() : v);
export const intakeSchema = z.object({
  client: z.discriminatedUnion('kind',[
    z.object({kind:z.literal('existing'),partyId:uuid}).strict(),
    z.object({kind:z.literal('new'),partyKind:z.enum(['person','organisation']),name:short,clientCode:z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,20}$/).optional(),phone:z.string().trim().max(50).optional().default(''),email:z.union([z.email(),z.literal('')]).optional().default('')}).strict(),
  ]),
  owner: z.discriminatedUnion('kind',[
    z.object({kind:z.literal('existing'),partyId:uuid}).strict(),
    z.object({kind:z.literal('new'),partyKind:z.enum(['person','organisation']),name:short,phone:z.string().trim().max(50).optional().default(''),email:z.union([z.email(),z.literal('')]).optional().default('')}).strict(),
  ]),
  visitContact: z.discriminatedUnion('kind',[
    z.object({kind:z.literal('existing'),partyId:uuid}).strict(),
    z.object({kind:z.literal('new'),name:short,phone:z.string().trim().min(3).max(50),email:z.union([z.email(),z.literal('')])}).strict(),
  ]),
  vehicle: z.discriminatedUnion('kind', [
    z.object({ kind:z.literal('new'), vin: z.string().trim().toUpperCase().regex(/^[A-HJ-NPR-Z0-9]{17}$/, 'Enter a 17-character VIN without I, O or Q.'), registration: short, make: short, model: short, variant:z.string().trim().max(160).transform(value=>value||null).optional().default(null), powertrain:z.string().trim().max(160).transform(value=>value||null).optional().default(null) }).strict(),
    z.object({ kind:z.literal('existing'), vehicleId:uuid }).strict(),
  ]),
  odometerKm: z.number().int().min(0).max(10000000),
  socPercent: z.number().int().min(0).max(100).nullable(),
  powertrainClass:z.enum(['EV','HYB','ICE']),
  warrantyStatus:z.enum(['confirmed','not-confirmed','unknown']),
  warrantyConfirmationNote:z.string().trim().max(500).optional().default(''),
  complaint: wording,
}).strict().superRefine((value,context)=>{
  if (value.warrantyStatus==='confirmed'&&!value.warrantyConfirmationNote.trim()) context.addIssue({code:'custom',path:['warrantyConfirmationNote'],message:'Record the warranty confirmation basis before adding W to the booking reference.'});
  if (value.warrantyStatus!=='confirmed'&&value.warrantyConfirmationNote.trim()) context.addIssue({code:'custom',path:['warrantyConfirmationNote'],message:'A warranty confirmation basis is only used when warranty is confirmed at booking creation.'});
});
export const clientMatchSchema=z.array(z.object({id:uuid,clientCode:z.string(),kind:z.enum(['person','organisation']),name:z.string()})).max(20);
export const partyMatchSchema=z.array(z.object({id:uuid,kind:z.enum(['person','organisation']),name:z.string()})).max(20);
export const vehicleMatchSchema = z.object({
  id:uuid,vin:z.string(),registration:z.string().nullable(),make:z.string(),model:z.string(),variant:z.string().nullable(),powertrain:z.string().nullable(),
}).nullable();
export const complaintSchema = z.object({ expectedVersion, wording }).strict();
export const taskSchema = z.object({ expectedVersion, complaintId: uuid, title: short }).strict();
export const operationsReviewCommandSchema = z.object({ expectedVersion, notes: z.string().trim().max(1000).optional().default('') }).strict();
export const operationsReviewResultSchema = z.object({ workOrderId: uuid, reviewId: uuid, reviewerName: z.string(), reviewedAt: at, reviewedWorkOrderVersion: z.number().int().positive(), version: z.number().int().positive() });
export const leadAssignmentSchema = z.object({ expectedVersion, operationsReviewId: uuid, leadUserId: uuid, reason: z.string().trim().min(1).max(1000) }).strict();
export const workPlanCommandSchema = z.object({
  expectedVersion,
  rationale: z.string().trim().min(1).max(1000),
  taskIds: z.array(uuid).min(1).max(50).refine(items => new Set(items).size === items.length, 'Choose each planned task once.'),
}).strict();
export const workPlanSchema = z.object({
  id: uuid,
  revisionNumber: z.number().int().positive(),
  leadAssignmentId: uuid,
  workOrderVersion: z.number().int().positive(),
  plannedBy: z.string(),
  plannedAt: at,
  rationale: z.string(),
  tasks: z.array(z.object({ taskId: uuid, reference: z.string(), title: z.string() })),
  isCurrent: z.boolean(),
});
export const workPlanBlockReasonSchema = z.enum([
  'assigned-lead-required',
  'operations-review-required',
  'site-write-required',
  'authority-required',
  'qualification-required',
  'planned-tasks-required',
]);
export const workOrderWorkflowContextSchema = z.object({
  stage:z.enum(['operations-review','team-lead-assignment','team-lead-work-plan','supervisor-handoff','supervisor-task-work']),
  responsibility:z.object({role:z.enum(['operations','team-lead','supervisor']),name:z.string().nullable(),source:z.enum(['operations-queue','team-lead-assignment','supervisor-handoff'])}).strict(),
  nextAction:z.enum(['review-job','assign-team-lead','prepare-work-plan','assign-supervisor','manage-task-work']),
  actionReadiness:z.enum(['available','blocked','check-action-section']),
  blockReason:z.enum(['operations-review-authority-required','assigned-lead-required','operations-review-required','site-write-required','authority-required','qualification-required','planned-tasks-required']).nullable(),
  dueAt:z.null(),
  evidenceChecklist:z.literal('awaiting-approved-sop'),
}).strict();
export const supervisorHandoffSchema = z.object({ expectedVersion, supervisorUserId: uuid, workPlanRevisionId: uuid, reason: z.string().trim().min(1).max(1000) }).strict();
export const eligibleTeamLeadSchema=z.object({canAssign:z.boolean(),blockReason:z.enum(['authority-required','operations-review-required','no-qualified-leads']).nullable(),teamLeads:z.array(z.object({id:uuid,name:z.string(),qualificationCode:z.string()}))});
export const eligibleSupervisorSchema=z.object({canHandoff:z.boolean(),supervisors:z.array(z.object({id:uuid,name:z.string(),qualificationCode:z.string()}))});
const diagnosticShort = z.string().trim().min(1).max(160);
const diagnosticText = z.string().trim().min(1).max(4000);
const diagnosticLimitedText = z.string().trim().min(1).max(2000);
export const diagnosticObservationSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('dtc'), code: diagnosticShort, system: diagnosticShort.optional(), status: diagnosticShort.optional(),
    freezeFrame: z.array(z.object({ name: diagnosticShort, value: diagnosticShort, unit: diagnosticShort.optional() }).strict()).max(100).optional(),
  }).strict(),
  z.object({ kind: z.literal('software-version'), component: diagnosticShort, version: diagnosticShort }).strict(),
  z.object({ kind: z.literal('condition'), description: diagnosticText }).strict(),
  z.object({ kind: z.literal('measurement'), name: diagnosticShort, value: diagnosticShort, unit: diagnosticShort, condition: diagnosticText.optional() }).strict(),
  z.object({ kind: z.literal('reproduction-attempt'), conditions: diagnosticText, outcome: diagnosticText }).strict(),
  z.object({ kind: z.literal('procedure-reference'), title: diagnosticShort, source: diagnosticShort, revision: diagnosticShort.optional() }).strict(),
]);
const diagnosticCertaintySchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('stated'), explanation: diagnosticLimitedText }).strict(),
  z.object({ state: z.literal('inconclusive'), explanation: diagnosticLimitedText }).strict(),
]);
export const diagnosticFindingInputSchema = z.object({
  expectedVersion,
  complaintId: uuid,
  taskId: uuid.nullable().optional(),
  supersedesFindingId: uuid.nullable().optional(),
  observedAt: z.iso.datetime({ offset: true }),
  summary: diagnosticText,
  certainty: diagnosticCertaintySchema,
  residualRisk: diagnosticText,
  restrictions: diagnosticLimitedText.nullable().optional(),
  observations: z.array(diagnosticObservationSchema).min(1).max(50),
  evidenceIds: z.array(uuid).max(50).refine(items => new Set(items).size === items.length, 'Choose each evidence file once.').default([]),
}).strict();
export const diagnosticFindingSchema = z.object({
  id: uuid, complaintId: uuid, taskId: uuid.nullable(), supersedesFindingId: uuid.nullable(),
  recordedBy: z.string(), recordedAt: at, observedAt: at, summary: diagnosticText,
  certainty: diagnosticCertaintySchema, residualRisk: diagnosticText, restrictions: diagnosticLimitedText.nullable(),
  observations: z.array(diagnosticObservationSchema), evidenceIds: z.array(uuid),
});
export const intakeFactInputSchema = z.discriminatedUnion('kind', [
  z.object({kind:z.literal('condition-observation'),area:wording,description:wording,evidenceIds:z.array(uuid).max(50).refine(items=>new Set(items).size===items.length).default([])}).strict(),
  z.object({kind:z.literal('damage-observation'),area:wording,description:wording,evidenceIds:z.array(uuid).max(50).refine(items=>new Set(items).size===items.length).default([])}).strict(),
  z.object({kind:z.literal('accessory-observation'),description:wording,evidenceIds:z.array(uuid).max(50).refine(items=>new Set(items).size===items.length).default([])}).strict(),
  z.object({kind:z.literal('key-observation'),description:wording,evidenceIds:z.array(uuid).max(50).refine(items=>new Set(items).size===items.length).default([])}).strict(),
  z.object({kind:z.literal('fuel-reading'),value:z.number().finite().min(0).max(100000),unit:short,observation:wording,evidenceIds:z.array(uuid).max(50).refine(items=>new Set(items).size===items.length).default([])}).strict(),
  z.object({kind:z.literal('custody-observation'),description:wording,evidenceIds:z.array(uuid).max(50).refine(items=>new Set(items).size===items.length).default([])}).strict(),
  z.object({kind:z.literal('safety-observation'),description:wording,evidenceIds:z.array(uuid).max(50).refine(items=>new Set(items).size===items.length).default([])}).strict(),
]);
export const intakeFactCommandSchema = z.object({
  expectedVersion,
  fact:intakeFactInputSchema,
  supersedesFactId:uuid.nullable().optional(),
  correctionReason:diagnosticLimitedText.nullable().optional(),
}).strict().superRefine((value,context)=>{
  if (value.supersedesFactId && !value.correctionReason?.trim()) context.addIssue({code:'custom',path:['correctionReason'],message:'Give a reason when correcting an earlier fact.'});
  if (!value.supersedesFactId && value.correctionReason) context.addIssue({code:'custom',path:['correctionReason'],message:'A correction reason requires an earlier fact to supersede.'});
});
export const intakeFactSchema = z.object({
  id:uuid,recordedBy:z.string(),recordedAt:at,
  fact:intakeFactInputSchema,
  supersedesFactId:uuid.nullable(),correctionReason:z.string().nullable(),
});
export const holdSchema = z.object({
  expectedVersion,
  scope: z.discriminatedUnion('kind', [z.object({kind:z.literal('workOrder')}).strict(),z.object({kind:z.literal('task'),taskId:uuid}).strict()]),
  category:z.enum(['safety','approval','parts','equipment','competency','other']),
  severity:z.enum(['stop','warning']),reason:wording,source:wording,
}).strict();
export const summarySchema = z.object({
  id:uuid,reference:z.string(),version:z.number().int(),createdAt:at,clientName:z.string().nullable(),vehicleLabel:z.string(),vin:z.string(),registration:z.string().nullable(),status:z.literal('intakeDraft'),complaintCount:z.number().int(),openHoldCount:z.number().int(),
});
export const workOrderEvidenceSchema = z.object({
  evidenceId:uuid,uploadIntentId:uuid.nullable(),displayName:z.string(),mediaType:z.string(),sizeBytes:z.number().int().positive(),sha256:z.string().regex(/^[0-9a-f]{64}$/),
  state:z.enum(['pending','quarantined','accepted','rejected']),scanDetailCode:z.string().nullable(),uploadedAt:at,attachedAt:at.nullable(),attachedBy:z.string().nullable(),
});
export const detailSchema = summarySchema.extend({
  client:z.object({id:uuid,kind:z.enum(['person','organisation','unknown-legacy']),name:z.string(),phone:z.string().nullable(),email:z.string().nullable()}).nullable(),
  owner:z.object({id:uuid,kind:z.enum(['person','organisation','unknown-legacy']),name:z.string(),phone:z.string().nullable(),email:z.string().nullable(),state:z.enum(['reported','verified','rejected','superseded'])}).nullable(),
  visitContact:z.object({id:uuid,kind:z.enum(['person','organisation','unknown-legacy']),name:z.string(),phone:z.string().nullable(),email:z.string().nullable()}).nullable(),
  clientCode:z.string().nullable(),clientBookingSequence:z.number().int().nullable(),powertrainClass:z.enum(['EV','HYB','ICE']).nullable(),warrantyStatusAtBooking:z.enum(['confirmed','not-confirmed','unknown']).nullable(),
  canReviewOperations:z.boolean(),
  operationsReview:z.object({id:uuid,reviewedByName:z.string(),reviewedAt:at,notes:z.string(),reviewedWorkOrderVersion:z.number().int().positive(),isCurrent:z.boolean()}).nullable(),
  teamLeadAssignment:z.object({id:uuid,leadUserId:uuid,leadName:z.string(),operationsReviewId:uuid,powertrainClass:z.enum(['EV','HYB','ICE']),assignedByName:z.string(),assignedAt:at,reason:z.string()}).nullable(),
  supervisorHandoff:z.object({supervisorUserId:uuid,supervisorName:z.string(),assignedByName:z.string(),powertrainClass:z.enum(['EV','HYB','ICE']),assignedAt:at,reason:z.string(),workPlanRevisionId:uuid,workPlanRevisionNumber:z.number().int().positive(),workOrderVersion:z.number().int().positive(),isCurrent:z.boolean()}).nullable(),
  workPlan:workPlanSchema.nullable(),
  canPrepareWorkPlan:z.boolean(),
  workPlanBlockReason:workPlanBlockReasonSchema.nullable(),
  workflowContext:workOrderWorkflowContextSchema,
  vehicle:z.object({id:uuid,vin:z.string(),registration:z.string().nullable(),make:z.string(),model:z.string(),variant:z.string().nullable(),powertrain:z.string().nullable()}),
  vehicleHistory:z.array(z.object({id:uuid,reference:z.string(),openedAt:at,registration:z.string().nullable(),clientName:z.string().nullable(),reportedOwnerName:z.string().nullable(),odometerKm:z.number().int(),socPercent:z.number().int().nullable(),complaints:z.array(z.object({reference:z.string(),wording:z.string()}))})),
  odometerKm:z.number().int(),socPercent:z.number().int().nullable(),
  complaints:z.array(z.object({id:uuid,reference:z.string(),wording:z.string()})),
  tasks:z.array(z.object({id:uuid,reference:z.string(),title:z.string(),complaintId:uuid,state:z.literal('planned')})),
  holds:z.array(z.object({id:uuid,category:z.string(),severity:z.string(),reason:z.string(),source:z.string(),taskId:uuid.nullable(),openedAt:at,openedBy:z.string()})),
  evidence:z.array(workOrderEvidenceSchema),
  intakeFacts:z.array(intakeFactSchema),
  diagnosticFindings:z.array(diagnosticFindingSchema),
  history:z.array(z.object({id:uuid,action:z.string(),at,actor:z.string(),reason:z.string()})),
  gates:z.array(z.object({code:z.string(),label:z.string(),state:z.literal('pending'),missing:z.array(z.string())})),
});
export type WorkOrderDetail = z.infer<typeof detailSchema>;
