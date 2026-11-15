import { z } from "zod";

export const intakeFieldsSchema = z.object({
  clientKind: z.enum(["person", "organisation"]),
  clientName: z.string(),
  clientSearch: z.string(),
  clientCode: z.string(),
  clientPhone: z.string(),
  clientEmail: z.string(),
  ownerKind: z.enum(["person", "organisation"]),
  ownerPartyId: z.string().default(""),
  ownerSearch: z.string().default(""),
  ownerName: z.string(),
  ownerPhone: z.string(),
  ownerEmail: z.string(),
  visitContactName: z.string(),
  visitContactPartyId: z.string().default(""),
  visitContactSearch: z.string().default(""),
  phone: z.string(),
  email: z.string(),
  vin: z.string(),
  registration: z.string(),
  make: z.string(),
  model: z.string(),
  variant: z.string().default(""),
  powertrain: z.string().default(""),
  powertrainClass: z.enum(["", "EV", "HYB", "ICE"]),
  warrantyStatus: z.enum(["confirmed", "not-confirmed", "unknown"]),
  warrantyConfirmationNote: z.string(),
  odometerKm: z.string(),
  socPercent: z.string(),
  complaint: z.string(),
});
export type IntakeFields = z.infer<typeof intakeFieldsSchema>;
export const emptyIntake: IntakeFields = {
  clientKind: "organisation",
  clientName: "",
  clientSearch: "",
  clientCode: "",
  clientPhone: "",
  clientEmail: "",
  ownerKind: "person",
  ownerPartyId: "",
  ownerSearch: "",
  ownerName: "",
  ownerPhone: "",
  ownerEmail: "",
  visitContactName: "",
  visitContactPartyId: "",
  visitContactSearch: "",
  phone: "",
  email: "",
  vin: "",
  registration: "",
  make: "",
  model: "",
  variant: "",
  powertrain: "",
  powertrainClass: "",
  warrantyStatus: "unknown",
  warrantyConfirmationNote: "",
  odometerKm: "",
  socPercent: "",
  complaint: "",
};
const draftSchema = z.object({
  draftId: z.string().uuid(),
  commandId: z.string().uuid(),
  fields: intakeFieldsSchema,
  selectedClientId: z.string().uuid().nullable().default(null),
  selectedVehicleId: z.string().uuid().nullable().default(null),
  clientSelectionNeedsReview: z.boolean().default(false),
  vehicleSelectionNeedsReview: z.boolean().default(false),
  savedAt: z.iso.datetime(),
});
export type IntakeDraft = z.infer<typeof draftSchema>;
export const INTAKE_DRAFT_MAX_AGE_MS = 8 * 60 * 60 * 1000;
const prefix = "vmms:draft:v3:";
const previousPrefix = "vmms:draft:v2:";
const legacyPrefix = "vmms:draft:v1:";
const key = (userId: string, siteId: string) => `${prefix}${userId}:${siteId}`;
const evidencePrefix = "vmms:evidence-draft:v1:";
const taskEvidencePrefix = "vmms:task-evidence-draft:v1:";
const requestPrefix = "vmms:request-draft:v1:";
const requestIntakePrefix = "vmms:request-intake:v1:";
const requestContactAttemptPrefix = "vmms:request-contact-attempt:v1:";
const requestContactCorrectionPrefix = "vmms:request-contact-correction:v1:";
const requestIntakeKey=(userId:string,siteId:string,requestId:string)=>`${requestIntakePrefix}${userId}:${siteId}:${requestId}`;
const requestContactAttemptKey=(userId:string,siteId:string,requestId:string)=>`${requestContactAttemptPrefix}${userId}:${siteId}:${requestId}`;
const requestContactCorrectionKey=(userId:string,siteId:string,requestId:string)=>`${requestContactCorrectionPrefix}${userId}:${siteId}:${requestId}`;
const requestIntakeSchema=draftSchema.extend({requestVersion:z.number().int().positive()});
export type RequestIntakeDraft=z.infer<typeof requestIntakeSchema>;
export function loadRequestIntakeDraft(userId:string,siteId:string,requestId:string):{draft:RequestIntakeDraft|null;error:string|null} {
  const key=requestIntakeKey(userId,siteId,requestId);
  try{
    const raw=sessionStorage.getItem(key);if(!raw)return {draft:null,error:null};
    let value:unknown;try{value=JSON.parse(raw);}catch{value=null;}
    const parsed=requestIntakeSchema.safeParse(value);
    if(!parsed.success||Date.now()-Date.parse(parsed.data.savedAt)>=INTAKE_DRAFT_MAX_AGE_MS||Date.parse(parsed.data.savedAt)>Date.now()+60000){sessionStorage.removeItem(key);return {draft:null,error:'The saved visit draft expired or could not be read.'};}
    return {draft:parsed.data,error:null};
  }catch{return {draft:null,error:'Tab storage is unavailable. Keep this page open until the visit is saved.'};}
}
export function saveRequestIntakeDraft(userId:string,siteId:string,requestId:string,draft:RequestIntakeDraft){sessionStorage.setItem(requestIntakeKey(userId,siteId,requestId),JSON.stringify(requestIntakeSchema.parse(draft)));}
export function removeRequestIntakeDraft(userId:string,siteId:string,requestId:string){sessionStorage.removeItem(requestIntakeKey(userId,siteId,requestId));}
const contactOutcome=z.enum(['reached','no-answer','callback-requested','other']);
const pendingContactAttemptSchema=z.object({
  commandId:z.string().uuid(),savedAt:z.iso.datetime(),
  body:z.object({expectedVersion:z.number().int().positive(),channel:z.string().min(1).max(80),outcome:contactOutcome,notes:z.string().max(4000),nextAction:z.string().max(1000).nullable(),callbackDueAt:z.iso.datetime({offset:true}).nullable()}).strict(),
}).strict();
const pendingContactCorrectionSchema=z.object({
  commandId:z.string().uuid(),savedAt:z.iso.datetime(),
  body:z.object({expectedVersion:z.number().int().positive(),entryId:z.string().uuid(),channel:z.string().min(1).max(80),outcome:contactOutcome,notes:z.string().max(4000),reason:z.string().min(1).max(500)}).strict(),
}).strict();
export type PendingContactAttempt=z.infer<typeof pendingContactAttemptSchema>;
export type PendingContactCorrection=z.infer<typeof pendingContactCorrectionSchema>;
function loadPendingRequestCommand<T extends z.ZodType>(key:string,schema:T):{draft:z.infer<T>|null;error:string|null}{
  try{
    const raw=sessionStorage.getItem(key);if(!raw)return {draft:null,error:null};
    let value:unknown;try{value=JSON.parse(raw);}catch{return {draft:null,error:'A saved contact action could not be read. Check contact history before recording another action.'};}
    const parsed=schema.safeParse(value);
    if(!parsed.success)return {draft:null,error:'A saved contact action could not be read. Check contact history before recording another action.'};
    return {draft:parsed.data,error:null};
  }catch{return {draft:null,error:'Tab storage is unavailable. Contact actions cannot be safely recovered after a lost response.'};}
}
export function loadPendingContactAttempt(userId:string,siteId:string,requestId:string){return loadPendingRequestCommand(requestContactAttemptKey(userId,siteId,requestId),pendingContactAttemptSchema);}
export function savePendingContactAttempt(userId:string,siteId:string,requestId:string,draft:PendingContactAttempt){sessionStorage.setItem(requestContactAttemptKey(userId,siteId,requestId),JSON.stringify(pendingContactAttemptSchema.parse(draft)));}
export function removePendingContactAttempt(userId:string,siteId:string,requestId:string){sessionStorage.removeItem(requestContactAttemptKey(userId,siteId,requestId));}
export function loadPendingContactCorrection(userId:string,siteId:string,requestId:string){return loadPendingRequestCommand(requestContactCorrectionKey(userId,siteId,requestId),pendingContactCorrectionSchema);}
export function savePendingContactCorrection(userId:string,siteId:string,requestId:string,draft:PendingContactCorrection){sessionStorage.setItem(requestContactCorrectionKey(userId,siteId,requestId),JSON.stringify(pendingContactCorrectionSchema.parse(draft)));}
export function removePendingContactCorrection(userId:string,siteId:string,requestId:string){sessionStorage.removeItem(requestContactCorrectionKey(userId,siteId,requestId));}
const requestKey = (userId:string,siteId:string) => `${requestPrefix}${userId}:${siteId}`;
const requestDraftSchema=z.object({
  fields:z.object({source:z.string().max(80),concern:z.string().max(4000),contact:z.string().max(500),contactPhone:z.string().max(80).default(''),contactRelationship:z.enum(['vehicle-owner','driver','client-contact','sales-contact','other','unknown']).default('unknown'),vehicle:z.string().max(500),client:z.string().max(500),followUp:z.boolean().default(false),nextAction:z.string().max(1000).default(''),callbackDueAt:z.string().max(40).default('')}).strict(),
  commandId:z.string().uuid(),attempted:z.boolean(),savedAt:z.iso.datetime(),
}).strict();
export type RequestDraft=z.infer<typeof requestDraftSchema>;
export function loadRequestDraft(userId:string,siteId:string):{draft:RequestDraft|null;error:string|null} {
  const key=requestKey(userId,siteId);
  try {
    const raw=sessionStorage.getItem(key); if(!raw) return {draft:null,error:null};
    let value:unknown; try {value=JSON.parse(raw);} catch {value=null;}
    const parsed=requestDraftSchema.safeParse(value);
    if(!parsed.success || Date.now()-Date.parse(parsed.data.savedAt)>=INTAKE_DRAFT_MAX_AGE_MS || Date.parse(parsed.data.savedAt)>Date.now()+60000) {
      sessionStorage.removeItem(key); return {draft:null,error:'The saved request expired or could not be read.'};
    }
    return {draft:parsed.data,error:null};
  } catch {return {draft:null,error:'Tab storage is unavailable. Keep this page open until the request is saved.'};}
}
export function saveRequestDraft(userId:string,siteId:string,draft:RequestDraft) {sessionStorage.setItem(requestKey(userId,siteId),JSON.stringify(requestDraftSchema.parse(draft)));}
export function removeRequestDraft(userId:string,siteId:string) {sessionStorage.removeItem(requestKey(userId,siteId));}
const evidenceKey = (userId: string, siteId: string, workOrderId: string) =>
  `${evidencePrefix}${userId}:${siteId}:${workOrderId}`;
const taskEvidenceKey = (userId: string, siteId: string, workOrderId: string, taskId: string) =>
  `${taskEvidencePrefix}${userId}:${siteId}:${workOrderId}:${taskId}`;
const evidenceDraftSchema = z.object({
  intentId: z.string().uuid().nullable(),
  intentCommandId: z.string().uuid(),
  displayName: z.string().min(1).max(255),
  declaredMediaType: z.string().min(1).max(160),
  expectedBytes: z.number().int().positive(),
  savedAt: z.iso.datetime(),
}).strict();
export type EvidenceDraft = z.infer<typeof evidenceDraftSchema>;
const taskEvidenceDraftSchema = evidenceDraftSchema.extend({
  workPlanRevisionId: z.string().uuid(),
  assignmentRevision: z.number().int().positive(),
}).strict();
export type TaskEvidenceDraft = z.infer<typeof taskEvidenceDraftSchema>;

export function loadDraft(
  userId: string,
  siteId: string,
): { draft: IntakeDraft | null; error: string | null } {
  try {
    const raw = sessionStorage.getItem(key(userId, siteId));
    if (!raw) {
      const previousKey = `${previousPrefix}${userId}:${siteId}`;
      const previousRaw = sessionStorage.getItem(previousKey);
      if (previousRaw) {
        const previous = draftSchema.safeParse(JSON.parse(previousRaw));
        if (!previous.success) {
          sessionStorage.removeItem(previousKey);
          return { draft: null, error: "The saved draft could not be updated safely. Start a new draft." };
        }
        const previousSavedAt = Date.parse(previous.data.savedAt);
        const previousNow = Date.now();
        if (previousNow - previousSavedAt >= INTAKE_DRAFT_MAX_AGE_MS || previousSavedAt > previousNow + 60_000) {
          sessionStorage.removeItem(previousKey);
          return { draft: null, error: "The saved draft expired and was removed. Start a new draft." };
        }
        const migrated: IntakeDraft = {
          ...previous.data,
          fields: { ...previous.data.fields, powertrainClass: "" },
          clientSelectionNeedsReview: true,
          vehicleSelectionNeedsReview: true,
        };
        sessionStorage.setItem(key(userId, siteId), JSON.stringify(migrated));
        sessionStorage.removeItem(previousKey);
        return { draft: migrated, error: null };
      }
      const legacyKey = `${legacyPrefix}${userId}:${siteId}`;
      const legacyRaw = sessionStorage.getItem(legacyKey);
      if (!legacyRaw) return { draft: null, error: null };
      const legacy = z.object({
        draftId: z.string().uuid(), commandId: z.string().uuid(), savedAt: z.iso.datetime(),
        fields: z.object({ customerName:z.string(),phone:z.string(),email:z.string(),vin:z.string(),registration:z.string(),make:z.string(),model:z.string(),variant:z.string(),powertrain:z.string(),odometerKm:z.string(),socPercent:z.string(),complaint:z.string() }),
      }).safeParse(JSON.parse(legacyRaw));
      if (!legacy.success) {
        sessionStorage.removeItem(legacyKey);
        return { draft: null, error: "The saved draft could not be safely separated into payer, owner and visit contact. It was removed; start a new draft." };
      }
      const legacySavedAt = Date.parse(legacy.data.savedAt);
      const legacyNow = Date.now();
      if (legacyNow - legacySavedAt >= INTAKE_DRAFT_MAX_AGE_MS || legacySavedAt > legacyNow + 60_000) {
        sessionStorage.removeItem(legacyKey);
        return { draft: null, error: "The saved draft expired and was removed. Start a new draft." };
      }
      const migrated: IntakeDraft = {
        ...legacy.data,
        fields: { ...emptyIntake, visitContactName:legacy.data.fields.customerName, phone:legacy.data.fields.phone, email:legacy.data.fields.email, vin:legacy.data.fields.vin, registration:legacy.data.fields.registration, make:legacy.data.fields.make, model:legacy.data.fields.model, variant:legacy.data.fields.variant, powertrain:legacy.data.fields.powertrain, odometerKm:legacy.data.fields.odometerKm, socPercent:legacy.data.fields.socPercent, complaint:legacy.data.fields.complaint },
        selectedClientId: null,
        selectedVehicleId: null,
        clientSelectionNeedsReview: true,
        vehicleSelectionNeedsReview: true,
      };
      sessionStorage.setItem(key(userId, siteId), JSON.stringify(migrated));
      sessionStorage.removeItem(legacyKey);
      return { draft: migrated, error: null };
    }
    const rawDraft = JSON.parse(raw) as Record<string, unknown>;
    const parsed = draftSchema.safeParse(rawDraft);
    if (!parsed.success) {
      sessionStorage.removeItem(key(userId, siteId));
      return {
        draft: null,
        error: "The saved tab draft could not be read. Start a new draft.",
      };
    }
    const needsClientReview = !Object.hasOwn(rawDraft, "selectedClientId")
      || !Object.hasOwn(rawDraft, "clientSelectionNeedsReview");
    const needsVehicleReview = !Object.hasOwn(rawDraft, "selectedVehicleId")
      || !Object.hasOwn(rawDraft, "vehicleSelectionNeedsReview");
    const recovered = {
      ...parsed.data,
      clientSelectionNeedsReview: parsed.data.clientSelectionNeedsReview || needsClientReview,
      vehicleSelectionNeedsReview: parsed.data.vehicleSelectionNeedsReview || needsVehicleReview,
    };
    const savedAt = Date.parse(parsed.data.savedAt);
    const now = Date.now();
    if (now - savedAt >= INTAKE_DRAFT_MAX_AGE_MS || savedAt > now + 60_000) {
      sessionStorage.removeItem(key(userId, siteId));
      return {
        draft: null,
        error: "The saved draft expired and was removed. Start a new draft.",
      };
    }
    if (needsClientReview || needsVehicleReview) {
      sessionStorage.setItem(key(userId, siteId), JSON.stringify(recovered));
    }
    return { draft: recovered, error: null };
  } catch {
    return {
      draft: null,
      error:
        "Tab storage is unavailable. Keep this page open until you submit your entries.",
    };
  }
}

export function saveDraft(userId: string, siteId: string, draft: IntakeDraft) {
  sessionStorage.setItem(key(userId, siteId), JSON.stringify(draft));
}

export function removeDraft(userId: string, siteId: string) {
  sessionStorage.removeItem(key(userId, siteId));
}

export function clearAccountDrafts(userId: string) {
  for (let i = sessionStorage.length - 1; i >= 0; i -= 1) {
    const storedKey = sessionStorage.key(i);
    if (
      storedKey?.startsWith(`${prefix}${userId}:`) ||
      storedKey?.startsWith(`${previousPrefix}${userId}:`) ||
      storedKey?.startsWith(`${legacyPrefix}${userId}:`) ||
      storedKey?.startsWith(`${evidencePrefix}${userId}:`) ||
      storedKey?.startsWith(`${taskEvidencePrefix}${userId}:`) ||
      storedKey?.startsWith(`${requestPrefix}${userId}:`) ||
      storedKey?.startsWith(`${requestIntakePrefix}${userId}:`) ||
      storedKey?.startsWith(`${requestContactAttemptPrefix}${userId}:`) ||
      storedKey?.startsWith(`${requestContactCorrectionPrefix}${userId}:`)
    )
      sessionStorage.removeItem(storedKey);
  }
}

export function clearAllWorkspaceDrafts() {
  for (let i = sessionStorage.length - 1; i >= 0; i -= 1) {
    const storedKey = sessionStorage.key(i);
    if (storedKey?.startsWith(prefix) || storedKey?.startsWith(previousPrefix) || storedKey?.startsWith(legacyPrefix) || storedKey?.startsWith(evidencePrefix) || storedKey?.startsWith(taskEvidencePrefix) || storedKey?.startsWith(requestPrefix) || storedKey?.startsWith(requestIntakePrefix) || storedKey?.startsWith(requestContactAttemptPrefix) || storedKey?.startsWith(requestContactCorrectionPrefix)) {
      sessionStorage.removeItem(storedKey);
    }
  }
}

export function loadEvidenceDraft(
  userId: string,
  siteId: string,
  workOrderId: string,
): { draft: EvidenceDraft | null; error: string | null } {
  const storedKey = evidenceKey(userId, siteId, workOrderId);
  try {
    const raw = sessionStorage.getItem(storedKey);
    if (!raw) return { draft: null, error: null };
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch {
      sessionStorage.removeItem(storedKey);
      return { draft: null, error: "The saved upload details could not be read and were removed." };
    }
    const parsed = evidenceDraftSchema.safeParse(parsedJson);
    if (!parsed.success) {
      sessionStorage.removeItem(storedKey);
      return { draft: null, error: "The saved upload details could not be read and were removed." };
    }
    const savedAt = Date.parse(parsed.data.savedAt);
    const now = Date.now();
    if (now - savedAt >= INTAKE_DRAFT_MAX_AGE_MS || savedAt > now + 60_000) {
      sessionStorage.removeItem(storedKey);
      return { draft: null, error: "The saved upload details expired and were removed. Choose the file again to start over." };
    }
    return { draft: parsed.data, error: null };
  } catch {
    return { draft: null, error: "Tab storage is unavailable. Keep this page open until the upload is attached." };
  }
}

export function saveEvidenceDraft(
  userId: string,
  siteId: string,
  workOrderId: string,
  draft: EvidenceDraft,
) {
  sessionStorage.setItem(evidenceKey(userId, siteId, workOrderId), JSON.stringify(draft));
}

export function removeEvidenceDraft(userId: string, siteId: string, workOrderId: string) {
  sessionStorage.removeItem(evidenceKey(userId, siteId, workOrderId));
}

export function loadTaskEvidenceDraft(
  userId: string,
  siteId: string,
  workOrderId: string,
  taskId: string,
  workPlanRevisionId: string,
  assignmentRevision: number,
): { draft: TaskEvidenceDraft | null; error: string | null } {
  const storedKey = taskEvidenceKey(userId, siteId, workOrderId, taskId);
  try {
    const raw = sessionStorage.getItem(storedKey);
    if (!raw) return { draft: null, error: null };
    let value: unknown;
    try { value = JSON.parse(raw); } catch { value = null; }
    const parsed = taskEvidenceDraftSchema.safeParse(value);
    if (!parsed.success) {
      sessionStorage.removeItem(storedKey);
      return { draft: null, error: "The saved task upload details could not be read and were removed." };
    }
    const savedAt = Date.parse(parsed.data.savedAt);
    const now = Date.now();
    if (now - savedAt >= INTAKE_DRAFT_MAX_AGE_MS || savedAt > now + 60_000) {
      sessionStorage.removeItem(storedKey);
      return { draft: null, error: "The saved task upload details expired and were removed. Choose the file again." };
    }
    if (parsed.data.workPlanRevisionId !== workPlanRevisionId
      || parsed.data.assignmentRevision !== assignmentRevision) {
      sessionStorage.removeItem(storedKey);
      return { draft: null, error: "The task assignment changed. Start a new upload after reviewing the current task." };
    }
    return { draft: parsed.data, error: null };
  } catch {
    return { draft: null, error: "Tab storage is unavailable. Keep this page open until the upload and work entry are saved." };
  }
}

export function saveTaskEvidenceDraft(
  userId: string,
  siteId: string,
  workOrderId: string,
  taskId: string,
  draft: TaskEvidenceDraft,
) {
  sessionStorage.setItem(taskEvidenceKey(userId, siteId, workOrderId, taskId), JSON.stringify(taskEvidenceDraftSchema.parse(draft)));
}

export function removeTaskEvidenceDraft(userId: string, siteId: string, workOrderId: string, taskId: string) {
  sessionStorage.removeItem(taskEvidenceKey(userId, siteId, workOrderId, taskId));
}
