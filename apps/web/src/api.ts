import { z } from "zod";
import { vehicleLearningAssessmentSchema } from "./vehicle-learning-assessment";

const siteSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  code: z.string(),
  timeZone: z.string().min(1).max(64),
  canWrite: z.boolean(),
  roleCodes: z.array(z.string()).default([]),
});
export const sessionSchema = z.discriminatedUnion("authenticated", [
  z.object({ authenticated: z.literal(false) }),
  z.object({
    authenticated: z.literal(true),
    user: z.object({ id: z.string().uuid(), displayName: z.string() }),
    sites: z.array(siteSchema),
  }),
]);
export type Session = z.infer<typeof sessionSchema>;
export type StaffSession = Extract<Session, { authenticated: true }>;
export type Site = z.infer<typeof siteSchema>;
const financeReferenceSchema = z.string().trim().min(1).max(240).nullable();
const financeProposalTextSchema = z.string().trim().min(1).max(240).nullable();
export const financeConfigurationDraftContentSchema = z.object({
  schemaVersion: z.literal(1),
  legalEntity: z.object({
    proposedName: financeProposalTextSchema,
    registrationReference: financeReferenceSchema,
    businessAddress: z.string().trim().min(1).max(500).nullable(),
    businessContactReference: financeReferenceSchema,
  }).strict(),
  currencyCode: z.string().regex(/^[A-Z]{3}$/).nullable(),
  rateScheduleReference: financeReferenceSchema,
  taxTreatmentReference: financeReferenceSchema,
  invoiceNumberingRuleReference: financeReferenceSchema,
  receiptNumberingRuleReference: financeReferenceSchema,
  paymentTermsReference: financeReferenceSchema,
  paymentVerificationSourceReference: financeReferenceSchema,
  paymentEvidencePolicyReference: financeReferenceSchema,
  showroomGuaranteeAuthorityReference: financeReferenceSchema,
  invoiceTemplateReference: financeReferenceSchema,
  receiptTemplateReference: financeReferenceSchema,
  emailSenderConfigurationReference: financeReferenceSchema,
  verifiedClientEmailPolicyReference: financeReferenceSchema,
  correctionPolicyReference: financeReferenceSchema,
  retentionPolicyReference: financeReferenceSchema,
  sourceReferences: z.array(z.object({
    label: z.string().trim().min(1).max(120),
    reference: z.string().trim().min(1).max(240),
  }).strict()).max(30),
}).strict();
export type FinanceConfigurationDraftContent = z.infer<typeof financeConfigurationDraftContentSchema>;
export const financeConfigurationDraftItemSchema = z.object({
  draftId: z.string().uuid(),
  revisionId: z.string().uuid(),
  revision: z.number().int().positive(),
  previousRevision: z.number().int().positive().nullable(),
  revisionNote: z.string(),
  content: financeConfigurationDraftContentSchema,
  state: z.literal("draft-only"),
  operationallyEffective: z.literal(false),
  createdAt: z.string().datetime({ offset: true }),
  isCurrent: z.boolean(),
}).strict();
export type FinanceConfigurationDraftItem = z.infer<typeof financeConfigurationDraftItemSchema>;
export const financeConfigurationDraftListSchema = z.object({
  items: z.array(financeConfigurationDraftItemSchema),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  totalItems: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
  canManage: z.boolean(),
}).strict();
export const financeConfigurationDraftSaveSchema = financeConfigurationDraftItemSchema.omit({ isCurrent: true });
export const vehicleMatchSchema = z.object({
  id: z.string().uuid(),
  vin: z.string(),
  registration: z.string().nullable(),
  make: z.string(),
  model: z.string(),
  variant: z.string().nullable(),
  powertrain: z.string().nullable(),
}).nullable();
export const salesDeliverySchema=z.object({
  id:z.string().uuid(),vehicleId:z.string().uuid(),vin:z.string(),registrationAtDelivery:z.string().nullable(),make:z.string(),model:z.string(),variant:z.string().nullable(),powertrain:z.string().nullable(),deliveredOn:z.string(),purchaserAtDeliveryClaim:z.string().nullable(),purchaserSource:z.string().nullable(),sourceReference:z.string().nullable(),recordedBy:z.string(),recordedAt:z.string(),
}).strict();
export const pdiObservationSchema=z.object({
  id:z.string().uuid(),deliveryId:z.string().uuid(),area:z.string(),observation:z.string(),sourceReference:z.string().nullable(),correctsObservationId:z.string().uuid().nullable(),correctionReason:z.string().nullable(),recordedBy:z.string(),recordedAt:z.string(),
}).strict();
export const deliveryPreparationSchema=z.object({
  id:z.string().uuid(),vehicleId:z.string().uuid(),vin:z.string(),make:z.string(),model:z.string(),variant:z.string().nullable(),powertrain:z.string().nullable(),
  summary:z.string(),sourceReference:z.string(),recordedBy:z.string(),recordedAt:z.string(),version:z.union([z.literal(1),z.literal(2)]),
  linkedDeliveryId:z.string().uuid().nullable(),linkedAt:z.string().nullable(),
}).strict();
export const vehicleSalesHistorySchema=z.object({items:z.array(salesDeliverySchema.extend({pdiObservations:z.array(pdiObservationSchema)})),preparations:z.array(deliveryPreparationSchema)}).strict();
export const clientMatchSchema = z.array(z.object({ id:z.string().uuid(),clientCode:z.string(),kind:z.enum(["person","organisation"]),name:z.string() })).max(20);
export const partyMatchSchema = z.array(z.object({ id:z.string().uuid(),kind:z.enum(["person","organisation"]),name:z.string() })).max(20);
export const ownerSessionSchema = z.discriminatedUnion("authenticated", [
  z.object({ authenticated: z.literal(false) }),
  z.object({ authenticated: z.literal(true), audience: z.literal("owner") }),
]);
export type OwnerSession = z.infer<typeof ownerSessionSchema>;
export const rpLogoutResponseSchema = z.discriminatedUnion("centralLogout", [
  z.object({ localSignedOut: z.literal(true), centralLogout: z.literal("started"), logoutUrl: z.string().url() }),
  z.object({ localSignedOut: z.literal(true), centralLogout: z.literal("unavailable"), logoutUrl: z.null() }),
]);
export const ownerVehicleListSchema = z.object({
  vehicles: z.array(z.object({
    id: z.string().uuid(),
    registration: z.string().nullable(),
    make: z.string(),
    model: z.string(),
  }).strict()),
}).strict();
export const workforceOverviewSchema = z.object({
  asOf: z.string().datetime({ offset: true }),
  workOrders: z.object({
    active: z.number().int().nonnegative(),
    held: z.number().int().nonnegative(),
    awaitingOperationsReview: z.number().int().nonnegative(),
    awaitingTeamLead: z.number().int().nonnegative(),
    assignedToTeamLead: z.number().int().nonnegative(),
  }).strict(),
  staff: z.object({
    active: z.number().int().nonnegative(),
    activeRolePlacements: z.number().int().nonnegative(),
  }).strict(),
  taskProgress: z.object({
    blockedCount: z.number().int().nonnegative(),
    waitingCount: z.number().int().nonnegative(),
    items: z.array(z.object({
      workOrderId: z.string().uuid(),
      bookingReference: z.string(),
      taskReference: z.string(),
      taskTitle: z.string(),
      assigneeName: z.string(),
      state: z.enum(["blocked", "waiting"]),
      reportedAt: z.string().datetime({ offset: true }),
    }).strict()).max(12),
  }).strict(),
}).strict();
export const workforceActivitySchema=z.object({
  items:z.array(z.object({id:z.string().uuid(),createdAt:z.string().datetime({offset:true}),eventType:z.string(),aggregateType:z.string(),aggregateVersion:z.number().int().positive(),workOrderReference:z.string().nullable(),actorName:z.string()}).strict()),
  nextCursor:z.string().nullable(),pageSize:z.number().int().positive(),
}).strict();
export const staffMessageSchema = z.object({
  id: z.string().uuid(),
  senderUserId: z.string().uuid(),
  senderName: z.string(),
  recipients: z.array(z.object({
    userId: z.string().uuid(),
    displayName: z.string(),
    readAt: z.string().datetime({ offset: true }).nullable(),
  })),
  body: z.string(),
  workOrderId: z.string().uuid().nullable(),
  workOrderReference: z.string().nullable(),
  createdAt: z.string().datetime({ offset: true }),
  readAt: z.string().datetime({ offset: true }).nullable(),
}).strict();
export const staffMessagesSchema = z.object({
  items: z.array(staffMessageSchema),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  totalCount: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
  canSend: z.boolean(),
}).strict();
export const vehicleLearningEntrySchema=z.object({id:z.string().uuid(),title:z.string(),makeModel:z.string(),powertrain:z.string(),drivetrain:z.string(),systems:z.array(z.string()),evidence:z.string(),questions:z.string(),assessment:vehicleLearningAssessmentSchema,status:z.enum(['draft','submitted']),reviewDecision:z.enum(['changes-requested','reviewed-learning-record']).nullable(),version:z.number().int().positive(),updatedAt:z.string().datetime({offset:true})}).strict();
export const vehicleLearningListSchema=z.object({items:z.array(vehicleLearningEntrySchema)}).strict();
export const vehicleLearningRevisionSchema=z.object({entryId:z.string().uuid(),revisionNumber:z.number().int().positive(),title:z.string(),makeModel:z.string(),powertrain:z.string(),drivetrain:z.string(),systems:z.array(z.string()),evidence:z.string(),questions:z.string(),assessment:vehicleLearningAssessmentSchema,status:z.enum(['draft','submitted']),savedAt:z.string().datetime({offset:true})}).strict();
export const vehicleLearningCommentSchema=z.object({id:z.string().uuid(),entryId:z.string().uuid(),revisionNumber:z.number().int().positive(),commenterId:z.string().uuid(),commenterName:z.string(),body:z.string(),createdAt:z.string().datetime({offset:true})}).strict();
export const vehicleLearningReviewDecisionSchema=z.object({id:z.string().uuid(),entryId:z.string().uuid(),revisionNumber:z.number().int().positive(),reviewerId:z.string().uuid(),reviewerName:z.string(),decision:z.enum(['changes-requested','reviewed-learning-record']),reason:z.string(),shareWithAfterSales:z.boolean(),createdAt:z.string().datetime({offset:true})}).strict();
export const vehicleLearningActivitySchema=z.object({entryId:z.string().uuid(),revisions:z.array(vehicleLearningRevisionSchema),comments:z.array(vehicleLearningCommentSchema),reviews:z.array(vehicleLearningReviewDecisionSchema)}).strict();
export const vehicleLearningCommentResultSchema=vehicleLearningCommentSchema;
export const vehicleLearningReviewQueueSchema=z.object({items:z.array(z.object({id:z.string().uuid(),title:z.string(),makeModel:z.string(),powertrain:z.string(),drivetrain:z.string(),authorName:z.string(),version:z.number().int().positive(),updatedAt:z.string().datetime({offset:true})}).strict())}).strict();
export type VehicleLearningReviewQueue=z.infer<typeof vehicleLearningReviewQueueSchema>;
export const vehicleLearningReviewResultSchema=vehicleLearningReviewDecisionSchema;
export const vehicleLearningLibrarySchema=z.object({items:z.array(z.object({entryId:z.string().uuid(),title:z.string(),makeModel:z.string(),assessment:vehicleLearningAssessmentSchema,revisionNumber:z.number().int().positive(),reviewedAt:z.string().datetime({offset:true})}).strict()),q:z.string(),page:z.number().int().positive(),pageSize:z.number().int().positive(),total:z.number().int().nonnegative(),totalPages:z.number().int().nonnegative(),canManageSharing:z.boolean()}).strict();
export type VehicleLearningLibrary=z.infer<typeof vehicleLearningLibrarySchema>;
export const vehicleLearningShareRevocationSchema=z.object({id:z.string().uuid(),entryId:z.string().uuid(),revisionNumber:z.number().int().positive(),revokedAt:z.string().datetime({offset:true})}).strict();
export const controlledDocumentsSchema = z.object({
  documents: z.array(z.object({
    documentId: z.string().uuid(),
    reference: z.string(),
    alias: z.string().nullable(),
    title: z.string(),
    ownerName: z.string(),
    revision: z.string(),
    effectiveFrom: z.string(),
    reviewDueAt: z.string().nullable(),
  }).strict()),
  pagination: z.object({
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    totalItems: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
  }).strict(),
}).strict();
export type ControlledDocuments = z.infer<typeof controlledDocumentsSchema>;
export const staffAccountProvisioningRequestSchema = z.object({
  id:z.string().uuid(),
  displayName:z.string(),
  siteAccess:z.enum(["read-only","write-enabled"]),
  state:z.enum(["queued","provisioning","invitation-issued","active","suspended","failed"]),
  revision:z.number().int().positive(),
  createdAt:z.string().datetime({offset:true}),
}).strict();
export const staffAccountProvisioningRequestsSchema = z.object({
  requests:z.array(staffAccountProvisioningRequestSchema.extend({email:z.email()})),
  page:z.number().int().positive(),
  pageSize:z.number().int().positive(),
  totalCount:z.number().int().nonnegative(),
  totalPages:z.number().int().nonnegative(),
}).strict();
export const ownerOidcStartResponseSchema = z.object({
  authorizationUrl: z.url().refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" ||
      (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
  }),
});
export const vehicleServiceHistorySchema = z.object({
  vehicle: z.object({
    id: z.string().uuid(), vin: z.string(), registration: z.string().nullable(), make: z.string(), model: z.string(),
    variant: z.string().nullable(), powertrain: z.string().nullable(),
  }).strict().nullable(),
  items: z.array(z.object({
    workOrderId: z.string().uuid(), reference: z.string(), openedAt: z.string(), odometerKm: z.number().int().nonnegative(),
    complaints: z.array(z.string()),
    workEntries: z.array(z.object({
      id: z.string().uuid(), taskReference: z.string(), taskTitle: z.string(),
      kind: z.enum(["finding", "test", "action", "follow-up"]),
      result: z.enum(["observed", "reproduced", "not-reproduced", "inconclusive", "done", "partial", "pending", "blocked"]),
      summary: z.string(), detail: z.string(), actorName: z.string(), recordedAt: z.string(),
      supersedesEntryId: z.string().uuid().nullable(), correctionReason: z.string().nullable(),
    }).strict()),
  }).strict()),
  pagination: z.object({ page: z.number().int().positive(), pageSize: z.number().int().positive(), totalItems: z.number().int().nonnegative(), totalPages: z.number().int().nonnegative() }).strict(),
}).strict();

const summarySchema = z.object({
  id: z.string().uuid(),
  reference: z.string(),
  version: z.number().int(),
  createdAt: z.string(),
  clientName: z.string().nullable(),
  vehicleLabel: z.string(),
  vin: z.string(),
  registration: z.string().nullable(),
  status: z.literal("intakeDraft"),
  complaintCount: z.number().int(),
  openHoldCount: z.number().int(),
});
export const diagnosticObservationSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("dtc"), code: z.string(), system: z.string().optional(), status: z.string().optional(),
    freezeFrame: z.array(z.object({ name: z.string(), value: z.string(), unit: z.string().optional() })).optional(),
  }),
  z.object({ kind: z.literal("software-version"), component: z.string(), version: z.string() }),
  z.object({ kind: z.literal("condition"), description: z.string() }),
  z.object({ kind: z.literal("measurement"), name: z.string(), value: z.string(), unit: z.string(), condition: z.string().optional() }),
  z.object({ kind: z.literal("reproduction-attempt"), conditions: z.string(), outcome: z.string() }),
  z.object({ kind: z.literal("procedure-reference"), title: z.string(), source: z.string(), revision: z.string().optional() }),
]);
export type DiagnosticObservation = z.infer<typeof diagnosticObservationSchema>;
export const intakeFactInputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("condition-observation"), area: z.string(), description: z.string(), evidenceIds: z.array(z.string().uuid()) }),
  z.object({ kind: z.literal("damage-observation"), area: z.string(), description: z.string(), evidenceIds: z.array(z.string().uuid()) }),
  z.object({ kind: z.literal("accessory-observation"), description: z.string(), evidenceIds: z.array(z.string().uuid()) }),
  z.object({ kind: z.literal("key-observation"), description: z.string(), evidenceIds: z.array(z.string().uuid()) }),
  z.object({ kind: z.literal("fuel-reading"), value: z.number(), unit: z.string(), observation: z.string(), evidenceIds: z.array(z.string().uuid()) }),
  z.object({ kind: z.literal("custody-observation"), description: z.string(), evidenceIds: z.array(z.string().uuid()) }),
  z.object({ kind: z.literal("safety-observation"), description: z.string(), evidenceIds: z.array(z.string().uuid()) }),
]);
export const intakeFactSchema = z.object({
  id: z.string().uuid(), recordedBy: z.string(), recordedAt: z.string(),
  fact: intakeFactInputSchema, supersedesFactId: z.string().uuid().nullable(), correctionReason: z.string().nullable(),
});
export const listSchema = z.object({
  items: z.array(summarySchema),
  pagination: z.object({
    page: z.number().int(),
    pageSize: z.number().int(),
    totalItems: z.number().int(),
    totalPages: z.number().int(),
  }),
  totals: z.object({
    open: z.number().int(),
    held: z.number().int(),
    intakeDrafts: z.number().int(),
  }),
  asOf: z.string(),
});
export const myAssignedTasksSchema = z.object({
  items: z.array(z.object({
    workOrderId: z.string().uuid(),
    bookingReference: z.string(),
    registration: z.string().nullable(),
    vehicleLabel: z.string(),
    taskId: z.string().uuid(),
    taskReference: z.string(),
    taskTitle: z.string(),
    supervisorName: z.string(),
    planRevisionNumber: z.number().int().positive(),
    workPlanRevisionId: z.string().uuid(),
    assignmentRevision: z.number().int().positive(),
    assignedAt: z.string(),
  }).strict()),
  pagination: z.object({
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    totalItems: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
  }).strict(),
}).strict();
export const taskLaborSessionSchema = z.object({
  id: z.string().uuid(),
  workOrderId: z.string().uuid(),
  taskId: z.string().uuid(),
  workPlanRevisionId: z.string().uuid(),
  assignmentRevision: z.number().int().positive(),
  startedAt: z.iso.datetime({ offset: true }),
  stoppedAt: z.iso.datetime({ offset: true }).nullable(),
  elapsedSeconds: z.number().int().nonnegative(),
}).strict();
export const activeTaskLaborSessionSchema = z.object({
  session: taskLaborSessionSchema.nullable(),
}).strict();
export const detailSchema = summarySchema.extend({
  serviceKind: z.enum(["repair-maintenance", "routine-maintenance", "psai", "service-centre-pdi"]),
  serviceSource: z.enum(["showroom-stock", "partner-garage", "other", "unknown"]),
  shippingReference: z.string().nullable(),
  client: z.object({
    id: z.string().uuid(),
    kind: z.enum(["person", "organisation", "unknown-legacy"]),
    name: z.string(),
    phone: z.string().nullable(),
    email: z.string().nullable(),
  }).nullable(),
  owner: z.object({
    id: z.string().uuid(), kind: z.enum(["person", "organisation", "unknown-legacy"]), name: z.string(),
    phone: z.string().nullable(), email: z.string().nullable(), state: z.enum(["reported", "verified", "rejected", "superseded"]),
  }).nullable(),
  visitContact: z.object({
    id: z.string().uuid(), kind: z.enum(["person", "organisation", "unknown-legacy"]), name: z.string(),
    phone: z.string().nullable(), email: z.string().nullable(),
  }).nullable(),
  clientCode: z.string().nullable(),
  clientBookingSequence: z.number().int().nullable(),
  powertrainClass: z.enum(["EV","HYB","ICE"]).nullable(),
  warrantyStatusAtBooking: z.enum(["confirmed","not-confirmed","unknown"]).nullable(),
  canReviewOperations: z.boolean(),
  canResolveHolds: z.boolean(),
  operationsReview: z.object({id:z.string().uuid(),reviewedByName:z.string(),reviewedAt:z.iso.datetime(),notes:z.string(),reviewedWorkOrderVersion:z.number().int().positive(),isCurrent:z.boolean()}).nullable(),
  teamLeadAssignment: z.object({id:z.string().uuid(),leadUserId:z.string().uuid(),leadName:z.string(),operationsReviewId:z.string().uuid(),powertrainClass:z.enum(["EV","HYB","ICE"]),assignedByName:z.string(),assignedAt:z.iso.datetime(),reason:z.string()}).nullable(),
  supervisorHandoff: z.object({supervisorUserId:z.string().uuid(),supervisorName:z.string(),assignedByName:z.string(),powertrainClass:z.enum(["EV","HYB","ICE"]),assignedAt:z.iso.datetime(),reason:z.string(),workPlanRevisionId:z.string().uuid(),workPlanRevisionNumber:z.number().int().positive(),workOrderVersion:z.number().int().positive(),isCurrent:z.boolean()}).nullable(),
  workPlan: z.object({
    id:z.string().uuid(),revisionNumber:z.number().int().positive(),leadAssignmentId:z.string().uuid(),workOrderVersion:z.number().int().positive(),plannedBy:z.string(),plannedAt:z.iso.datetime(),rationale:z.string(),
    tasks:z.array(z.object({taskId:z.string().uuid(),reference:z.string(),title:z.string()})),isCurrent:z.boolean(),
  }).nullable(),
  canPrepareWorkPlan:z.boolean(),
  workPlanBlockReason:z.enum(["assigned-lead-required","operations-review-required","site-write-required","authority-required","qualification-required","planned-tasks-required"]).nullable(),
  workflowContext:z.object({
    stage:z.enum(["operations-review","team-lead-assignment","team-lead-work-plan","supervisor-handoff","supervisor-task-work"]),
    responsibility:z.object({role:z.enum(["operations","team-lead","supervisor"]),name:z.string().nullable(),source:z.enum(["operations-queue","team-lead-assignment","supervisor-handoff"])}).strict(),
    nextAction:z.enum(["review-job","assign-team-lead","prepare-work-plan","assign-supervisor","manage-task-work"]),
    actionReadiness:z.enum(["available","blocked","check-action-section"]),
    blockReason:z.enum(["operations-review-authority-required","assigned-lead-required","operations-review-required","site-write-required","authority-required","qualification-required","planned-tasks-required"]).nullable(),
    dueAt:z.null(),
    evidenceChecklist:z.literal("awaiting-approved-sop"),
  }).strict(),
  closeoutPath:z.array(z.object({
    code:z.enum(["operations-review","lead-handoff","technician-work","supervisor-completion","team-lead-release","head-inspection","client-update"]),
    label:z.string().min(1),responsibleRole:z.string().min(1),state:z.enum(["complete","current","waiting","not-available"]),detail:z.string().min(1),
  }).strict()).length(7),
  completionReadiness:z.object({
    currentWorkPlan:z.boolean(),currentSupervisorHandoff:z.boolean(),openHoldCount:z.number().int().nonnegative(),
    tasks:z.array(z.object({taskId:z.string().uuid(),reference:z.string(),title:z.string(),assigneeName:z.string().nullable(),
      workEntryCount:z.number().int().nonnegative(),completedActionCount:z.number().int().nonnegative(),openActionCount:z.number().int().nonnegative(),followUpCount:z.number().int().nonnegative(),
      checklistOutcomeCount:z.number().int().nonnegative(),checklistNeedsReviewCount:z.number().int().nonnegative()}).strict()),
    blockers:z.array(z.object({code:z.enum(['current-work-plan-required','supervisor-handoff-required','task-assignment-required','task-work-record-required','task-action-not-complete','task-follow-up-open','task-checklist-review-required','open-hold','effective-g2-scope-unavailable','effective-task-instructions-unavailable','authority-validation-unavailable','signoff-command-unavailable']),message:z.string().min(1),taskId:z.string().uuid().nullable()}).strict()),
    state:z.literal('blocked'),
  }).strict(),
  vehicle: z.object({
    id: z.string().uuid(),
    vin: z.string(),
    registration: z.string().nullable(),
    make: z.string(),
    model: z.string(),
    variant: z.string().nullable(),
    powertrain: z.string().nullable(),
  }),
  vehicleHistory: z.array(z.object({
    id: z.string().uuid(),
    reference: z.string(),
    openedAt: z.string(),
    registration: z.string().nullable(),
    clientName: z.string().nullable(),
    reportedOwnerName: z.string().nullable(),
    odometerKm: z.number().int(),
    socPercent: z.number().int().nullable(),
    complaints: z.array(z.object({ reference: z.string(), wording: z.string() })),
  })),
  odometerKm: z.number(),
  socPercent: z.number().nullable(),
  complaints: z.array(
    z.object({
      id: z.string().uuid(),
      reference: z.string(),
      wording: z.string(),
    }),
  ),
  tasks: z.array(
    z.object({
      id: z.string().uuid(),
      reference: z.string(),
      title: z.string(),
      complaintId: z.string().uuid(),
      state: z.literal("planned"),
    }),
  ),
  holds: z.array(
    z.object({
      id: z.string().uuid(),
      category: z.enum([
        "safety",
        "approval",
        "parts",
        "equipment",
        "competency",
        "other",
      ]),
      severity: z.enum(["stop", "warning"]),
      reason: z.string(),
      source: z.string(),
      taskId: z.string().uuid().nullable(),
      openedAt: z.string(),
      openedBy: z.string(),
      resolution: z.object({reason:z.string(),resolvedAt:z.string(),resolvedBy:z.string(),evidenceIds:z.array(z.string().uuid())}).nullable(),
    }),
  ),
  evidence: z.array(
    z.object({
      evidenceId: z.string().uuid(),
      uploadIntentId: z.string().uuid().nullable(),
      displayName: z.string(),
      mediaType: z.string(),
      sizeBytes: z.number().int().positive(),
      sha256: z.string().regex(/^[0-9a-f]{64}$/),
      state: z.enum(["pending", "quarantined", "accepted", "rejected"]),
      scanDetailCode: z.string().nullable(),
      uploadedAt: z.string(),
      attachedAt: z.string().nullable(),
      attachedBy: z.string().nullable(),
    }),
  ),
  diagnosticFindings: z.array(
    z.object({
      id: z.string().uuid(), complaintId: z.string().uuid(), taskId: z.string().uuid().nullable(),
      supersedesFindingId: z.string().uuid().nullable(), recordedBy: z.string(), recordedAt: z.string(), observedAt: z.string(),
      summary: z.string(),
      certainty: z.object({ state: z.enum(["stated", "inconclusive"]), explanation: z.string() }),
      residualRisk: z.string(), restrictions: z.string().nullable(),
      observations: z.array(diagnosticObservationSchema), evidenceIds: z.array(z.string().uuid()),
    }),
  ),
  intakeFacts: z.array(intakeFactSchema),
  history: z.array(
    z.object({
      id: z.string().uuid(),
      action: z.string(),
      at: z.string(),
      actor: z.string(),
      reason: z.string(),
    }),
  ),
  gates: z.array(
    z.object({
      code: z.string(),
      label: z.string(),
      state: z.literal("pending"),
      missing: z.array(z.string()),
    }),
  ),
});
export type WorkOrder = z.infer<typeof detailSchema>;
export const serviceReportEntrySchema = z.object({
    id: z.string().uuid(), taskId: z.string().uuid(), taskReference: z.string(), taskTitle: z.string(),
    complaintReference: z.string(), kind: z.enum(["finding", "test", "action", "follow-up"]),
    result: z.enum(["observed", "reproduced", "not-reproduced", "inconclusive", "done", "partial", "pending", "blocked"]),
    summary: z.string(), detail: z.string(), observedAt: z.iso.datetime().nullable(), recordedAt: z.iso.datetime(),
    actorName: z.string(), evidenceIds: z.array(z.string().uuid()),
    evidence: z.array(z.object({ evidenceId: z.string().uuid(), displayName: z.string(), mediaType: z.string() }).strict()),
    supersedesEntryId: z.string().uuid().nullable(),
    correctionReason: z.string().nullable(),
  }).strict();
export const serviceReportPaginationSchema = z.object({
  page: z.number().int().positive(), pageSize: z.number().int().positive(),
  totalItems: z.number().int().nonnegative(), totalPages: z.number().int().nonnegative(),
}).strict();
export const serviceReportPageSchema = z.object({
  generatedAt: z.iso.datetime().nullable(),
  workOrderVersion: z.number().int().positive(),
  order: detailSchema.nullable(),
  entries: z.array(serviceReportEntrySchema),
  pagination: serviceReportPaginationSchema,
}).strict();
export const serviceReportSchema = serviceReportPageSchema.extend({
  generatedAt: z.iso.datetime(),
  order: detailSchema,
});
export type ServiceReport = z.infer<typeof serviceReportSchema>;
export const sourceReportItemSchema = z.object({
  id: z.string().uuid(), ordinal: z.number().int().positive(),
  kind: z.enum(["concern", "finding", "test", "action", "follow-up"]),
  result: z.enum(["reported", "observed", "reproduced", "not-reproduced", "inconclusive", "done", "partial", "pending", "blocked"]),
  summary: z.string(), detail: z.string(), sourceOccurrenceDate: z.iso.date().nullable(),
  complaintId: z.string().uuid().nullable(), complaintReference: z.string().nullable(),
}).strict();
export const sourceReportRevisionSchema = z.object({
  id: z.string().uuid(), sourceDocumentId: z.string().uuid(),
  sourceKind: z.enum(["client-report", "workshop-report", "external-record", "other"]),
  title: z.string(), sourceDate: z.iso.date(), sourceEvidenceId: z.string().uuid().nullable(),
  sourceFile: z.object({ displayName: z.string(), mediaType: z.string() }).strict().nullable(),
  revision: z.number().int().positive(), recordedBy: z.string(), recordedAt: z.iso.datetime(),
  supersedesReportId: z.string().uuid().nullable(), correctionReason: z.string().nullable(),
  items: z.array(sourceReportItemSchema),
}).strict();
export const sourceReportHistorySchema = z.object({
  workOrderId: z.string().uuid(), workOrderVersion: z.number().int().positive(),
  reports: z.array(sourceReportRevisionSchema),
}).strict();
export type SourceReportHistory = z.infer<typeof sourceReportHistorySchema>;
export type SourceReportRevision = z.infer<typeof sourceReportRevisionSchema>;
export const sourceReportInputSchema = z.object({
  expectedVersion: z.number().int().positive(),
  sourceKind: z.enum(["client-report", "workshop-report", "external-record", "other"]),
  title: z.string().trim().min(1).max(160), sourceDate: z.iso.date(), sourceEvidenceId: z.string().uuid().nullable(),
  items: z.array(z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("concern"), summary: z.string().trim().min(1).max(160), detail: z.string().trim().max(4000), existingComplaintId: z.string().uuid().nullable() }).strict(),
    z.object({ kind: z.literal("finding"), result: z.enum(["observed", "inconclusive"]), summary: z.string().trim().min(1).max(160), detail: z.string().trim().max(4000), sourceOccurrenceDate: z.iso.date().nullable(), relatedConcernOrdinal: z.number().int().positive().nullable() }).strict(),
    z.object({ kind: z.literal("test"), result: z.enum(["reproduced", "not-reproduced", "inconclusive"]), summary: z.string().trim().min(1).max(160), detail: z.string().trim().max(4000), sourceOccurrenceDate: z.iso.date().nullable(), relatedConcernOrdinal: z.number().int().positive().nullable() }).strict(),
    z.object({ kind: z.literal("action"), result: z.enum(["done", "partial", "blocked"]), summary: z.string().trim().min(1).max(160), detail: z.string().trim().max(4000), sourceOccurrenceDate: z.iso.date().nullable(), relatedConcernOrdinal: z.number().int().positive().nullable() }).strict(),
    z.object({ kind: z.literal("follow-up"), result: z.enum(["pending", "done", "blocked"]), summary: z.string().trim().min(1).max(160), detail: z.string().trim().max(4000), sourceOccurrenceDate: z.iso.date().nullable(), relatedConcernOrdinal: z.number().int().positive().nullable() }).strict(),
  ])).min(1).max(50), supersedesReportId: z.string().uuid().nullable(),
  correctionReason: z.string().trim().min(1).max(1000).nullable(),
}).strict().superRefine((value, context) => {
  const concernCount = value.items.filter(item => item.kind === "concern").length;
  value.items.forEach((item, index) => {
    if (item.kind !== "concern" && item.relatedConcernOrdinal !== null && item.relatedConcernOrdinal > concernCount) context.addIssue({ code: "custom", path: ["items", index, "relatedConcernOrdinal"], message: "Choose a concern listed in this report." });
  });
  if ((value.supersedesReportId === null) !== (value.correctionReason === null)) context.addIssue({ code: "custom", path: ["correctionReason"], message: "Give a reason when correcting an earlier transcription." });
  const linked = value.items.flatMap(item => item.kind === "concern" && item.existingComplaintId ? [item.existingComplaintId] : []);
  if (new Set(linked).size !== linked.length) context.addIssue({ code: "custom", path: ["items"], message: "Link each existing concern at most once." });
});
export type SourceReportInput = z.infer<typeof sourceReportInputSchema>;
export const operationsReviewResultSchema=z.object({workOrderId:z.string().uuid(),reviewId:z.string().uuid(),reviewerName:z.string(),reviewedAt:z.iso.datetime(),reviewedWorkOrderVersion:z.number().int().positive(),version:z.number().int().positive()});
export const eligibleSupervisorsSchema=z.object({canHandoff:z.boolean(),supervisors:z.array(z.object({id:z.string().uuid(),name:z.string(),qualificationCode:z.string()}))});
export const eligibleTeamLeadsSchema=z.object({canAssign:z.boolean(),blockReason:z.enum(["authority-required","operations-review-required","no-qualified-leads"]).nullable(),teamLeads:z.array(z.object({id:z.string().uuid(),name:z.string(),qualificationCode:z.string()}))});
export const workPlanResultSchema=z.object({workOrderId:z.string().uuid(),workPlan:z.object({id:z.string().uuid(),revisionNumber:z.number().int().positive(),leadAssignmentId:z.string().uuid(),workOrderVersion:z.number().int().positive(),plannedBy:z.string(),plannedAt:z.iso.datetime(),rationale:z.string(),tasks:z.array(z.object({taskId:z.string().uuid(),reference:z.string(),title:z.string()})),isCurrent:z.boolean()}),version:z.number().int().positive()});
export const taskAllocationsSchema=z.object({
  workOrderId:z.string().uuid(),workOrderVersion:z.number().int().positive(),planRevisionId:z.string().uuid().nullable(),
  planRevisionNumber:z.number().int().positive().nullable(),canAssign:z.boolean(),
  blockReason:z.enum(["handoff-required","current-plan-required","operations-review-required","no-direct-reports","site-write-required"]).nullable(),
  activityAudience:z.enum(["supervisor","team-lead","head-service-centre"]).nullable(),
  tasks:z.array(z.object({taskId:z.string().uuid(),reference:z.string(),title:z.string(),assigneeId:z.string().uuid().nullable(),assigneeName:z.string().nullable(),assignmentRevision:z.number().int().positive().nullable()})),
  assignees:z.array(z.object({staffUserId:z.string().uuid(),displayName:z.string(),roleCode:z.literal("technician-engineer-trainee"),placementId:z.string().uuid(),currentPlanTaskCount:z.number().int().nonnegative(),lastReportedBlockedTaskCount:z.number().int().nonnegative(),lastReportedWaitingTaskCount:z.number().int().nonnegative()})),
}).strict();
export const taskAllocationResultSchema=z.object({
  workOrderId:z.string().uuid(),version:z.number().int().positive(),planRevisionId:z.string().uuid(),
  assignments:z.array(z.object({taskId:z.string().uuid(),staffUserId:z.string().uuid(),displayName:z.string(),revision:z.number().int().positive()})),
}).strict();

export const evidenceIntentSchema = z.object({
  id: z.string().uuid(),
  expiresAt: z.string(),
  maxBytes: z.number().int().positive(),
  expectedBytes: z.number().int().positive(),
  displayName: z.string(),
  declaredMediaType: z.string(),
  state: z.enum(["issued", "completed"]),
});

export const evidenceRecordSchema = z.object({
  id: z.string().uuid(),
  purpose: z.string(),
  targetId: z.string().uuid().nullable(),
  displayName: z.string(),
  mediaType: z.string(),
  declaredMediaType: z.string(),
  sizeBytes: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  state: z.enum(["pending", "quarantined", "accepted", "rejected"]),
  uploadedAt: z.iso.datetime(),
  scanDetailCode: z.string().nullable(),
}).strict();

export const evidenceIntentStatusSchema = z.discriminatedUnion("state", [
  z.object({
    id: z.string().uuid(),
    purpose: z.string(),
    targetId: z.string().uuid().nullable(),
    displayName: z.string(),
    declaredMediaType: z.string(),
    expectedBytes: z.number().int().positive(),
    expiresAt: z.string(),
    state: z.literal("issued"),
    evidenceId: z.null(),
    evidenceState: z.null(),
  }),
  z.object({
    id: z.string().uuid(),
    purpose: z.string(),
    targetId: z.string().uuid().nullable(),
    displayName: z.string(),
    declaredMediaType: z.string(),
    expectedBytes: z.number().int().positive(),
    expiresAt: z.string(),
    state: z.literal("expired"),
    evidenceId: z.null(),
    evidenceState: z.null(),
  }),
  z.object({
    id: z.string().uuid(),
    purpose: z.string(),
    targetId: z.string().uuid().nullable(),
    displayName: z.string(),
    declaredMediaType: z.string(),
    expectedBytes: z.number().int().positive(),
    expiresAt: z.string(),
    state: z.literal("completed"),
    evidenceId: z.string().uuid(),
    evidenceState: z.enum(["pending", "quarantined", "accepted", "rejected"]),
  }),
]);
export type EvidenceIntentStatus = z.infer<typeof evidenceIntentStatusSchema>;
const evidenceUploadResponseSchema = z.object({
  evidenceId: z.string().uuid(),
  state: z.literal("pending"),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  sizeBytes: z.number().int().positive(),
  mediaType: z.string(),
});

const errorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    fields: z
      .record(z.string(), z.union([z.string(), z.array(z.string())]))
      .optional(),
    currentVersion: z.number().optional(),
  }),
});

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly fields: Record<string, string | string[]> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function csrfToken(): string {
  const value = document.cookie
    .split("; ")
    .find((cookie) => cookie.startsWith("vmms_csrf="));
  return value ? decodeURIComponent(value.substring("vmms_csrf=".length)) : "";
}

export async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  options: {
    method?: "GET" | "POST" | "DELETE";
    body?: unknown;
    commandId?: string;
  } = {},
): Promise<T> {
  const method = options.method ?? "GET";
  const headers = new Headers({ Accept: "application/json" });
  if (method !== "GET") headers.set("X-CSRFToken", csrfToken());
  if (options.body !== undefined)
    headers.set("Content-Type", "application/json");
  if (options.commandId) headers.set("Idempotency-Key", options.commandId);
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      method,
      headers,
      credentials: "same-origin",
      cache: "no-store",
      ...(options.body !== undefined
        ? { body: JSON.stringify(options.body) }
        : {}),
    });
  } catch {
    throw new ApiError(
      "The server could not be reached. Your entries are still here. Check the connection before retrying.",
      0,
      "network",
    );
  }
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = errorSchema.safeParse(data);
    if (response.status === 401) {
      if (path.startsWith("/owner/") && path !== "/owner/session")
        window.dispatchEvent(new Event("vmms-owner-session-expired"));
      else if (!path.startsWith("/owner/") && path !== "/session")
        window.dispatchEvent(new Event("vmms-session-expired"));
    }
    throw parsed.success
      ? new ApiError(
          parsed.data.error.message,
          response.status,
          parsed.data.error.code,
          parsed.data.error.fields,
        )
      : new ApiError(
          "The request could not be completed. Try again or contact your site administrator.",
          response.status,
          "request_failed",
        );
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success)
    throw new ApiError(
      "The server response could not be read. Refresh before making another change.",
      502,
      "invalid_response",
    );
  return parsed.data;
}

export async function uploadEvidenceFile(
  path: string,
  file: File,
  onProgress: (sent: number, total: number) => void,
): Promise<z.infer<typeof evidenceUploadResponseSchema>> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", `/api/v1${path}`);
    xhr.withCredentials = true;
    xhr.setRequestHeader("Accept", "application/json");
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.setRequestHeader("X-CSRFToken", csrfToken());
    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) onProgress(event.loaded, event.total);
    });
    xhr.addEventListener("error", () => {
      reject(
        new ApiError(
          "The upload could not be confirmed. Check this work order before starting another upload.",
          0,
          "network",
        ),
      );
    });
    xhr.addEventListener("load", () => {
      let data: unknown = null;
      try {
        const parsedJson: unknown = JSON.parse(xhr.responseText);
        data = parsedJson;
      } catch {
        data = null;
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        const parsed = errorSchema.safeParse(data);
        reject(
          parsed.success
            ? new ApiError(
                parsed.data.error.message,
                xhr.status,
                parsed.data.error.code,
                parsed.data.error.fields,
              )
            : new ApiError(
                "The upload could not be completed. Refresh the work order before retrying.",
                xhr.status,
                "upload_failed",
              ),
        );
        return;
      }
      const parsed = evidenceUploadResponseSchema.safeParse(data);
      if (!parsed.success) {
        reject(
          new ApiError(
            "The upload response could not be read. Refresh the work order before retrying.",
            502,
            "invalid_response",
          ),
        );
        return;
      }
      resolve(parsed.data);
    });
    xhr.send(file);
  });
}

export const sitePath = (siteId: string) =>
  `/sites/${encodeURIComponent(siteId)}`;
export const vehicleServiceHistoryPath = (siteId: string, vin: string, page = 1, pageSize = 10) => {
  const query = new URLSearchParams({ vin, page: String(page), pageSize: String(pageSize) });
  return `${sitePath(siteId)}/service-history?${query}`;
};
export const myAssignedTasksPath = (siteId: string, query: string, page: number, pageSize: number) => {
  const params = new URLSearchParams({ q: query, page: String(page), pageSize: String(pageSize) });
  return `${sitePath(siteId)}/my-tasks?${params}`;
};
export const myTaskLaborSessionPath = (siteId: string) =>
  `${sitePath(siteId)}/my-task-labor-session`;
export const myTaskLaborStartPath = (siteId: string, workOrderId: string, taskId: string) =>
  `${sitePath(siteId)}/my-tasks/${encodeURIComponent(workOrderId)}/${encodeURIComponent(taskId)}/labor/start`;
export const myTaskLaborStopPath = (siteId: string, sessionId: string) =>
  `${sitePath(siteId)}/my-task-labor-sessions/${encodeURIComponent(sessionId)}/stop`;
export const myTaskActivityPath = (siteId: string, workOrderId: string, taskId: string) =>
  `${sitePath(siteId)}/my-tasks/${encodeURIComponent(workOrderId)}/${encodeURIComponent(taskId)}/activity`;
export const myTaskWorkEntriesPath = (siteId: string, workOrderId: string, taskId: string, page = 1, pageSize = 25) => {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  return `${sitePath(siteId)}/my-tasks/${encodeURIComponent(workOrderId)}/${encodeURIComponent(taskId)}/work-entries?${params}`;
};
export const myTaskWorkEvidencePath = (siteId: string, workOrderId: string, taskId: string, page = 1, pageSize = 50) => {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  return `${sitePath(siteId)}/my-tasks/${encodeURIComponent(workOrderId)}/${encodeURIComponent(taskId)}/work-evidence?${params}`;
};
export const myTaskEvidenceIntentPath = (siteId: string, workOrderId: string, taskId: string) =>
  `${sitePath(siteId)}/my-tasks/${encodeURIComponent(workOrderId)}/${encodeURIComponent(taskId)}/evidence/intents`;
export const taskActivitySchema = z.object({
  id: z.string().uuid(),
  assignmentRevision: z.number().int().positive(),
  entryType: z.enum(["acknowledgement", "progress", "request", "comment", "review-response"]),
  progressState: z.enum(["working", "waiting", "blocked"]).nullable(),
  requestType: z.enum(["help", "parts", "information", "access", "evidence", "supervisor-review"]).nullable(),
  completionDeclaration: z.object({
    actionsSummary: z.string(), checksSummary: z.string(), outcome: z.enum(["reported-complete", "reported-incomplete", "blocked"]),
    remainingWork: z.string(),
  }).strict().nullable(),
  declarationWorkEntryIds: z.array(z.string().uuid()).nullable(),
  responseToActivityId: z.string().uuid().nullable(),
  responseToActorName: z.string().nullable(),
  responseToNote: z.string().nullable(),
  hasSupervisorResponse: z.boolean(),
  note: z.string(),
  actorName: z.string(),
  createdAt: z.string(),
}).strict();
export const taskActivityHistorySchema = z.object({
  workOrderId: z.string().uuid(),
  taskId: z.string().uuid(),
  workPlanRevisionId: z.string().uuid(),
  assignmentRevision: z.number().int().positive(),
  items: z.array(taskActivitySchema),
}).strict();
export const taskActivityResultSchema = z.object({
  workOrderId: z.string().uuid(),
  taskId: z.string().uuid(),
  activity: taskActivitySchema,
}).strict();
export const taskWorkEntrySchema = z.object({
  id: z.string().uuid(),
  assignmentRevision: z.number().int().positive(),
  kind: z.enum(["finding", "test", "action", "follow-up"]),
  result: z.enum(["observed", "reproduced", "not-reproduced", "inconclusive", "done", "partial", "pending", "blocked"]),
  summary: z.string(),
  detail: z.string(),
  observedAt: z.string().nullable(),
  actorName: z.string(),
  recordedAt: z.string(),
  evidenceIds: z.array(z.string().uuid()),
  supersedesEntryId: z.string().uuid().nullable(),
  correctionReason: z.string().nullable(),
}).strict();
export const taskWorkEntryHistorySchema = z.object({
  workOrderId: z.string().uuid(),
  taskId: z.string().uuid(),
  workPlanRevisionId: z.string().uuid(),
  assignmentRevision: z.number().int().positive(),
  items: z.array(taskWorkEntrySchema),
  pagination: z.object({
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    totalItems: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
  }).strict(),
}).strict();
export const taskWorkEntryResultSchema = z.object({
  workOrderId: z.string().uuid(),
  taskId: z.string().uuid(),
  entry: taskWorkEntrySchema,
}).strict();
export const taskWorkEvidenceOptionsSchema = z.object({
  workOrderId: z.string().uuid(),
  taskId: z.string().uuid(),
  workPlanRevisionId: z.string().uuid(),
  assignmentRevision: z.number().int().positive(),
  items: z.array(z.object({
    evidenceId: z.string().uuid(), displayName: z.string(), mediaType: z.string(),
    state: z.enum(["ready", "attached"]), uploadedAt: z.iso.datetime(),
  }).strict()),
  pagination: z.object({
    page: z.number().int().positive(), pageSize: z.number().int().positive(),
    totalItems: z.number().int().nonnegative(), totalPages: z.number().int().nonnegative(),
  }).strict(),
}).strict();
export const supervisorTaskActivityPageSchema=z.object({
  workOrderId:z.string().uuid(),planRevisionId:z.string().uuid(),
  canRespond:z.boolean(),responseBlockReason:z.enum(['authority-required','read-only']).nullable(),
  items:z.array(taskActivitySchema.extend({
    taskId:z.string().uuid(),taskReference:z.string(),taskTitle:z.string(),
    currentAssigneeName:z.string(),currentAssignmentRevision:z.number().int().positive(),
  }).strict()),
  pagination:z.object({page:z.number().int().positive(),pageSize:z.number().int().positive(),totalItems:z.number().int().nonnegative(),totalPages:z.number().int().nonnegative()}).strict(),
}).strict();
export const taskReviewQueueSchema = z.object({
  items: z.array(z.object({
    activityId: z.string().uuid(), workOrderId: z.string().uuid(), bookingReference: z.string(),
    vehicleLabel: z.string(), registration: z.string().nullable(), taskId: z.string().uuid(),
    taskReference: z.string(), taskTitle: z.string(), technicianName: z.string(), requesterName: z.string(),
    note: z.string(), createdAt: z.string().datetime({ offset: true }),
  }).strict()),
  pagination: z.object({ page: z.number().int().positive(), pageSize: z.number().int().positive(), totalItems: z.number().int().nonnegative(), totalPages: z.number().int().nonnegative() }).strict(),
}).strict();
export const taskReviewQueuePath = (siteId: string, page = 1, pageSize = 10) =>
  `${sitePath(siteId)}/task-review-requests?${new URLSearchParams({ page: String(page), pageSize: String(pageSize) })}`;
export const diagnosticReviewQueueSchema = z.object({
  items: z.array(z.object({
    findingId: z.string().uuid(), workOrderId: z.string().uuid(), bookingReference: z.string(),
    vehicleLabel: z.string(), registration: z.string().nullable(), complaintReference: z.string(),
    taskReference: z.string().nullable(), taskTitle: z.string().nullable(), summary: z.string(),
    certaintyState: z.enum(["stated", "inconclusive"]), certaintyExplanation: z.string(),
    residualRisk: z.string(), restrictions: z.string().nullable(), recordedAt: z.string().datetime({ offset: true }),
  }).strict()),
  pagination: z.object({ page: z.number().int().positive(), pageSize: z.number().int().positive(), totalItems: z.number().int().nonnegative(), totalPages: z.number().int().nonnegative() }).strict(),
}).strict();
export const diagnosticReviewQueuePath = (siteId: string, page = 1, pageSize = 10) =>
  `${sitePath(siteId)}/diagnostic-review-findings?${new URLSearchParams({ page: String(page), pageSize: String(pageSize) })}`;
export const checklistReviewQueueSchema = z.object({
  canReview: z.boolean(),
  blockReason: z.enum(["authority-required"]).nullable(),
  items: z.array(z.object({
    workOrderId: z.string().uuid(), bookingReference: z.string(), vehicleLabel: z.string(), registration: z.string().nullable(),
    taskId: z.string().uuid(), taskReference: z.string(), taskTitle: z.string(), checklistId: z.string().uuid(),
    checklistVersion: z.number().int().positive(), itemId: z.string().uuid(), itemCode: z.string(), itemLabel: z.string(),
    outcomeRevisionId: z.string().uuid(), outcomeRevision: z.number().int().positive(),
    result: z.enum(["completed", "failed", "not-checked", "not-completed", "blocked", "not-applicable"]),
    reason: z.string().nullable(), comments: z.string().nullable(), measurement: z.record(z.string(), z.unknown()).nullable(),
    evidence: z.array(z.object({ displayName: z.string(), mediaType: z.string() }).strict()),
    evidenceRequired: z.boolean(), evidenceCurrent: z.boolean(), hasOpenHold: z.boolean(), technicianName: z.string(),
    recordedAt: z.string().datetime({ offset: true }), workPlanRevisionId: z.string().uuid(), assignmentRevision: z.number().int().positive(),
  }).strict()),
  pagination: z.object({ page: z.number().int().positive(), pageSize: z.number().int().positive(), totalItems: z.number().int().nonnegative(), totalPages: z.number().int().nonnegative() }).strict(),
}).strict();
export type ChecklistReviewQueue = z.infer<typeof checklistReviewQueueSchema>;
export const checklistReviewQueuePath = (siteId: string, page = 1, pageSize = 10) =>
  `${sitePath(siteId)}/checklist-review-queue?${new URLSearchParams({ page: String(page), pageSize: String(pageSize) })}`;
export const checklistItemReviewPath = (siteId: string, item: ChecklistReviewQueue["items"][number]) =>
  `${sitePath(siteId)}/work-orders/${encodeURIComponent(item.workOrderId)}/tasks/${encodeURIComponent(item.taskId)}/checklists/${encodeURIComponent(item.checklistId)}/items/${encodeURIComponent(item.itemId)}/reviews`;
export const checklistItemReviewResultSchema = z.object({
  reviewId: z.string().uuid(), workOrderId: z.string().uuid(), checklistId: z.string().uuid(), itemId: z.string().uuid(),
  outcomeRevisionId: z.string().uuid(), disposition: z.enum(["record-confirmed", "returned-for-correction"]),
  checklistVersion: z.number().int().positive(), reviewedAt: z.string().datetime({ offset: true }),
}).strict();
export const workforceOverviewPath = (siteId: string) =>
  `${sitePath(siteId)}/workforce/overview`;
export const workforceActivityPath=(siteId:string,cursor?:string,pageSize=25)=>{
  const params=new URLSearchParams({pageSize:String(pageSize)});
  if(cursor) params.set("cursor",cursor);
  return `${sitePath(siteId)}/workforce/activity?${params}`;
};
export const controlledDocumentsPath = (siteId: string, q: string, page: number, pageSize: number) => {
  const params = new URLSearchParams({ q, page: String(page), pageSize: String(pageSize) });
  return `${sitePath(siteId)}/documents?${params}`;
};
export const controlledDocumentDownloadPath = (siteId: string, documentId: string) =>
  `${sitePath(siteId)}/documents/${encodeURIComponent(documentId)}/download`;
export const orderPath = (siteId: string, orderId: string) =>
  `${sitePath(siteId)}/work-orders/${encodeURIComponent(orderId)}`;
export const workOrderChecklistsPath = (siteId: string, orderId: string, page = 1, pageSize = 25) => {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  return `${orderPath(siteId, orderId)}/checklists?${params}`;
};
export const workOrderChecklistReportPath = (siteId: string, orderId: string, checklistId: string, page = 1, pageSize = 50, expectedChecklistVersion?: number) => {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (expectedChecklistVersion !== undefined) params.set("expectedChecklistVersion", String(expectedChecklistVersion));
  return `${orderPath(siteId, orderId)}/checklists/${encodeURIComponent(checklistId)}/report?${params}`;
};
const workOrderChecklistReportItemSchema=z.object({id:z.string().uuid(),code:z.string(),ordinal:z.number().int().positive(),label:z.string(),result:z.enum(["completed","failed","not-checked","not-completed","blocked","not-applicable"]).nullable(),reason:z.string().nullable(),applicabilityReason:z.string().nullable(),comments:z.string().nullable(),measurement:z.record(z.string(),z.unknown()).nullable(),actorName:z.string().nullable(),assigneeName:z.string().nullable(),taskReference:z.string().nullable(),taskTitle:z.string().nullable(),revision:z.number().int().positive().nullable(),correctionReason:z.string().nullable(),recordedAt:z.string().datetime({offset:true}).nullable(),evidenceLabels:z.array(z.string())}).strict().superRefine((item,context)=>{
  if(item.result!==null&&item.result!=="completed"&&!item.reason)context.addIssue({code:"custom",path:["reason"],message:"A non-complete result must include a reason."});
  if(item.result==="not-applicable"&&!item.applicabilityReason)context.addIssue({code:"custom",path:["applicabilityReason"],message:"A not-applicable result must include an applicability reason."});
});
export const workOrderChecklistReportSchema = z.object({
  workOrderId:z.string().uuid(),bookingReference:z.string(),siteName:z.string(),
  vehicle:z.object({registration:z.string().nullable(),make:z.string(),model:z.string(),variant:z.string().nullable(),powertrain:z.string().nullable()}).strict(),
  checklist:z.object({id:z.string().uuid(),kind:z.literal("routine-maintenance"),state:z.enum(["draft","in-progress","submitted","returned","approved","closed"]),version:z.number().int().positive(),scheduleBasis:z.enum(["verified-history","customer-request","delivery-inspection","unknown"]),odometerAtStartKm:z.number().int().nonnegative().nullable(),templateCode:z.string(),templateRevision:z.number().int().positive(),sources:z.array(z.object({reference:z.string(),title:z.string(),revision:z.string(),status:z.string(),effectiveFrom:z.string().datetime({offset:true}),effectiveUntil:z.string().datetime({offset:true}).nullable(),current:z.boolean()}).strict())}).strict(),
  summary:z.object({totalItems:z.number().int().nonnegative(),completed:z.number().int().nonnegative(),failed:z.number().int().nonnegative(),notChecked:z.number().int().nonnegative(),notCompleted:z.number().int().nonnegative(),blocked:z.number().int().nonnegative(),notApplicable:z.number().int().nonnegative()}).strict(),
  items:z.array(workOrderChecklistReportItemSchema),
  pagination:z.object({page:z.number().int().positive(),pageSize:z.number().int().positive(),totalItems:z.number().int().nonnegative(),totalPages:z.number().int().nonnegative()}).strict(),preparedAt:z.string().datetime({offset:true}),
}).strict();
export const scopeProposalsPath = (siteId:string,orderId:string) =>
  `${orderPath(siteId,orderId)}/scope-proposals`;
export const payerScopeResponsePath = (siteId:string,orderId:string,proposalId:string) =>
  `${scopeProposalsPath(siteId,orderId)}/${encodeURIComponent(proposalId)}/payer-response`;
export const payerScopeResponseInputSchema=z.object({
  expectedWorkOrderVersion:z.number().int().positive(),scopeRevisionId:z.string().uuid(),scopeDigest:z.string().regex(/^[0-9a-f]{64}$/),
  responseMethod:z.enum(['phone','written']),evidenceIds:z.array(z.string().uuid()).max(10),writtenEvidenceConfirmed:z.boolean(),
  decision:z.enum(['approved','declined']),respondentName:z.string().trim().min(1).max(180),
  respondentRelationship:z.enum(['payer','authorised-representative']),authorityBasis:z.string().trim().min(1).max(1000),
  identityCheckSummary:z.string().trim().min(1).max(1000),scopeReadBack:z.literal(true),responseSummary:z.string().trim().min(1).max(1200),
}).strict().superRefine((input,context)=>{
  if(input.responseMethod==='written'&&input.evidenceIds.length===0)context.addIssue({code:'custom',path:['evidenceIds'],message:'Attach accepted written evidence.'});
  if(input.responseMethod==='phone'&&input.evidenceIds.length>0)context.addIssue({code:'custom',path:['evidenceIds'],message:'Phone responses cannot include written evidence.'});
  if(input.responseMethod==='written'&&!input.writtenEvidenceConfirmed)context.addIssue({code:'custom',path:['writtenEvidenceConfirmed'],message:'Confirm the file contains the payer response to this exact scope.'});
  if(input.responseMethod==='phone'&&input.writtenEvidenceConfirmed)context.addIssue({code:'custom',path:['writtenEvidenceConfirmed'],message:'This confirmation is only for written responses.'});
  if(new Set(input.evidenceIds).size!==input.evidenceIds.length)context.addIssue({code:'custom',path:['evidenceIds'],message:'Choose each file once.'});
});
export const payerScopeResponseSchema=z.object({
  id:z.string().uuid(),decision:z.enum(['approved','declined']),responseMethod:z.enum(['phone','written']),evidenceIds:z.array(z.string().uuid()).max(10),writtenEvidenceConfirmed:z.boolean(),respondentName:z.string(),
  respondentRelationship:z.enum(['payer','authorised-representative']),authorityBasis:z.string(),identityCheckSummary:z.string(),
  scopeReadBack:z.literal(true),responseSummary:z.string(),recordedBy:z.string(),recordedAt:z.string(),
}).strict();
export const payerScopeResponseResultSchema=z.object({
  workOrderId:z.string().uuid(),scopeRevisionId:z.string().uuid(),scopeDigest:z.string().regex(/^[0-9a-f]{64}$/),
  workOrderVersion:z.number().int().positive(),response:payerScopeResponseSchema,
  authorizationState:z.literal('blocked'),authorizationReason:z.literal('technical-review-and-effective-policy-required'),
}).strict();
const scopeRevisionSchema=z.object({
  id:z.string().uuid(),revision:z.number().int().positive(),requestedKind:z.enum(['diagnosis','repair']),
  rationale:z.string(),estimate:z.object({minorUnits:z.string().regex(/^(0|[1-9][0-9]{0,37})$/),currency:z.string().regex(/^[A-Z]{3}$/)}).strict().nullable(),
  scopeDigest:z.string().regex(/^[0-9a-f]{64}$/),sourceWorkOrderVersion:z.number().int().positive(),
  supersedesRevisionId:z.string().uuid().nullable(),preparedBy:z.string(),preparedAt:z.string(),
  tasks:z.array(z.object({id:z.string().uuid(),reference:z.string(),title:z.string()})),
  payerResponse:payerScopeResponseSchema.nullable(),
}).strict();
const scopeProposalViewSchema=scopeRevisionSchema.extend({canRespond:z.boolean()}).strict();
export const scopeProposalPageSchema=z.object({
  workOrderId:z.string().uuid(),workOrderVersion:z.number().int().positive(),canPrepare:z.boolean(),
  blockReason:z.enum(['authority-required','read-only']).nullable(),
  canRecordPayerResponse:z.boolean(),payerResponseBlockReason:z.enum(['authority-required','read-only']).nullable(),
  proposals:z.array(scopeProposalViewSchema),
  plannedTasks:z.array(z.object({id:z.string().uuid(),reference:z.string(),title:z.string()})),
}).strict();
export const scopeProposalResultSchema=z.object({
  workOrderId:z.string().uuid(),
  proposal:scopeRevisionSchema,
  version:z.number().int().positive(),
}).strict();
export const workOrderChecklistsSchema = z.object({
  workOrderId: z.string().uuid(),
  workOrderVersion: z.number().int().positive(),
  vehicle: z.object({make:z.string(),model:z.string(),variant:z.string().nullable(),powertrain:z.string().nullable()}).strict(),
  checklists: z.array(z.object({
    id:z.string().uuid(),kind:z.literal("routine-maintenance"),state:z.enum(["draft","in-progress","submitted","returned","approved","closed"]),
    version:z.number().int().positive(),scheduleBasis:z.enum(["verified-history","customer-request","unknown"]),templateCode:z.string(),templateRevision:z.number().int().positive(),templateRevisionId:z.string().uuid(),
    odometerAtStartKm:z.number().int().nonnegative().nullable(),createdAt:z.string().datetime({offset:true}),
  }).strict()),
  availableTemplates: z.array(z.object({
    id:z.string().uuid(),code:z.string(),revision:z.number().int().positive(),kind:z.literal("routine-maintenance"),
    make:z.string(),model:z.string(),variant:z.string(),powertrain:z.string(),effectiveFrom:z.string().datetime({offset:true}),
  }).strict()),
  canPrepare:z.boolean(),
  prepareBlockReason:z.enum(["authority-required","read-only"]).nullable(),
  unavailableReason:z.string().nullable(),
  pagination:z.object({page:z.number().int().positive(),pageSize:z.number().int().positive(),totalItems:z.number().int().nonnegative(),totalPages:z.number().int().nonnegative()}).strict(),
}).strict();
export type WorkOrderChecklists = z.infer<typeof workOrderChecklistsSchema>;
export const workOrderChecklistDraftPath = (siteId:string,workOrderId:string) => `${orderPath(siteId,workOrderId)}/checklists`;
export const workOrderChecklistDraftResultSchema=z.object({
  workOrderId:z.string().uuid(),
  checklist:z.object({id:z.string().uuid(),kind:z.literal("routine-maintenance"),state:z.literal("draft"),version:z.literal(1),
    scheduleBasis:z.enum(["customer-request","unknown"]),odometerAtStartKm:z.number().int().nonnegative().nullable(),
    templateRevisionId:z.string().uuid(),createdAt:z.iso.datetime({offset:true})}).strict(),
}).strict();
export const serviceReportPath = (siteId: string, orderId: string, page = 1, expectedVersion?: number, expectedTotal?: number) => {
  const params = new URLSearchParams({ page: String(page) });
  if (expectedVersion !== undefined) params.set("expectedVersion", String(expectedVersion));
  if (expectedTotal !== undefined) params.set("expectedTotal", String(expectedTotal));
  return `${orderPath(siteId, orderId)}/service-report?${params}`;
};
export const sourceReportsPath = (siteId: string, orderId: string) =>
  `${orderPath(siteId, orderId)}/source-reports`;
export const intakeFactsPath = (siteId: string, orderId: string) =>
  `${orderPath(siteId, orderId)}/intake-facts`;
export const eligibleSupervisorsPath = (siteId:string,orderId:string) =>
  `${orderPath(siteId,orderId)}/eligible-supervisors`;
export const eligibleTeamLeadsPath = (siteId:string,orderId:string) =>
  `${orderPath(siteId,orderId)}/eligible-team-leads`;
export const taskAllocationsPath = (siteId:string,orderId:string) =>
  `${orderPath(siteId,orderId)}/task-allocations`;
export const supervisorTaskActivityPath = (siteId:string,orderId:string,page:number,pageSize:number) => {
  const params=new URLSearchParams({page:String(page),pageSize:String(pageSize)});
  return `${orderPath(siteId,orderId)}/task-activity?${params}`;
};
export const supervisorTaskReviewReplyPath = (siteId:string,orderId:string,taskId:string,activityId:string) =>
  `${orderPath(siteId,orderId)}/tasks/${encodeURIComponent(taskId)}/task-activity/${encodeURIComponent(activityId)}/reply`;
export const evidenceIntentPath = (siteId: string, intentId: string) =>
  `${sitePath(siteId)}/evidence/intents/${encodeURIComponent(intentId)}`;
export const evidenceRecordPath = (siteId: string, evidenceId: string) =>
  `${sitePath(siteId)}/evidence/${encodeURIComponent(evidenceId)}`;
export const evidenceIntentContentPath = (siteId: string, intentId: string) =>
  `${evidenceIntentPath(siteId, intentId)}/content`;
export const evidenceDownloadPath = (siteId: string, evidenceId: string) =>
  `/api/v1${sitePath(siteId)}/evidence/${encodeURIComponent(evidenceId)}/download`;
