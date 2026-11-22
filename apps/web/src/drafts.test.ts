import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, beforeEach, test } from "node:test";
import {
  clearAccountDrafts,
  clearAllWorkspaceDrafts,
  INTAKE_DRAFT_MAX_AGE_MS,
  loadEvidenceDraft,
  saveEvidenceDraft,
  loadRequestDraft,
  saveRequestDraft,
  loadPendingContactAttempt,
  savePendingContactAttempt,
  loadPendingContactCorrection,
  savePendingContactCorrection,
  emptyIntake,
  loadRequestIntakeDraft,
  saveRequestIntakeDraft,
} from "./drafts";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
}

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
const storage = new MemoryStorage();
Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: storage });
after(() => {
  if (originalStorage) Object.defineProperty(globalThis, "sessionStorage", originalStorage);
  else delete (globalThis as { sessionStorage?: Storage }).sessionStorage;
});

test('request visit drafts stay separate by account, site and request',()=>{
  const user=randomUUID(),site=randomUUID(),requestId=randomUUID();
  const draft={draftId:randomUUID(),commandId:randomUUID(),fields:emptyIntake,selectedClientId:null,selectedVehicleId:null,clientSelectionNeedsReview:false,vehicleSelectionNeedsReview:false,savedAt:new Date().toISOString(),requestVersion:4};
  saveRequestIntakeDraft(user,site,requestId,draft);
  assert.deepEqual(loadRequestIntakeDraft(user,site,requestId).draft,draft);
  assert.equal(loadRequestIntakeDraft(user,site,randomUUID()).draft,null);
  assert.equal(loadRequestIntakeDraft(user,randomUUID(),requestId).draft,null);
  assert.equal(loadRequestIntakeDraft(randomUUID(),site,requestId).draft,null);
  clearAccountDrafts(user);assert.equal(loadRequestIntakeDraft(user,site,requestId).draft,null);
  saveRequestIntakeDraft(user,site,requestId,{...draft,savedAt:new Date(Date.now()-INTAKE_DRAFT_MAX_AGE_MS).toISOString()});
  assert.equal(loadRequestIntakeDraft(user,site,requestId).draft,null);
  saveRequestIntakeDraft(user,site,requestId,draft);
  clearAllWorkspaceDrafts();assert.equal(loadRequestIntakeDraft(user,site,requestId).draft,null);
});

test('request draft is scoped, expires and is cleared on sign-out',()=>{
  const userId=randomUUID(),siteId=randomUUID();
  const draft={fields:{kind:'service-centre-pdi' as const,vehicleSource:'partner-garage' as const,shippingReference:'',source:'Phone',concern:'Synthetic concern',contact:'',contactPhone:'',contactRelationship:'unknown' as const,vehicle:'',client:'',followUp:false,nextAction:'',callbackDueAt:''},commandId:randomUUID(),attempted:true,savedAt:new Date().toISOString()};
  saveRequestDraft(userId,siteId,draft);
  assert.deepEqual(loadRequestDraft(userId,siteId).draft,draft);
  assert.equal(loadRequestDraft(randomUUID(),siteId).draft,null);
  assert.equal(loadRequestDraft(userId,randomUUID()).draft,null);
  clearAccountDrafts(userId);
  assert.equal(loadRequestDraft(userId,siteId).draft,null);
  saveRequestDraft(userId,siteId,{...draft,savedAt:new Date(Date.now()-INTAKE_DRAFT_MAX_AGE_MS).toISOString()});
  assert.equal(loadRequestDraft(userId,siteId).draft,null);
  saveRequestDraft(userId,siteId,draft); clearAllWorkspaceDrafts();
  assert.equal(loadRequestDraft(userId,siteId).draft,null);
});
test('older request drafts gain blank caller and follow-up details without guessing legacy contact text',()=>{
  const userId=randomUUID(),siteId=randomUUID();
  storage.setItem(`vmms:request-draft:v1:${userId}:${siteId}`,JSON.stringify({fields:{source:'Phone',concern:'Synthetic concern',contact:'Caller or number',vehicle:'',client:''},commandId:randomUUID(),attempted:false,savedAt:new Date().toISOString()}));
  const result=loadRequestDraft(userId,siteId);
  assert.equal(result.draft?.fields.contact,'Caller or number');
  assert.equal(result.draft?.fields.contactPhone,'');
  assert.equal(result.draft?.fields.contactRelationship,'unknown');
  assert.equal(result.draft?.fields.kind,'repair-maintenance');
  assert.equal(result.draft?.fields.vehicleSource,'unknown');
  assert.equal(result.draft?.fields.shippingReference,'');
  assert.equal(result.draft?.fields.followUp,false);
  assert.equal(result.draft?.fields.nextAction,'');
  assert.equal(result.draft?.fields.callbackDueAt,'');
});
test('pending contact commands survive reload state, stay scoped and clear on sign-out',()=>{
  const userId=randomUUID(),siteId=randomUUID(),requestId=randomUUID(),commandId=randomUUID();
  const contact={commandId,savedAt:new Date(Date.now()-9*60*60_000).toISOString(),body:{expectedVersion:4,channel:'Phone',outcome:'reached' as const,notes:'Synthetic saved contact',nextAction:null,callbackDueAt:null}};
  savePendingContactAttempt(userId,siteId,requestId,contact);
  assert.deepEqual(loadPendingContactAttempt(userId,siteId,requestId).draft,contact);
  assert.equal(loadPendingContactAttempt(randomUUID(),siteId,requestId).draft,null);
  assert.equal(loadPendingContactAttempt(userId,randomUUID(),requestId).draft,null);
  const correction={commandId:randomUUID(),savedAt:new Date().toISOString(),body:{expectedVersion:5,entryId:randomUUID(),channel:'Phone',outcome:'reached' as const,notes:'Synthetic correction',reason:'Synthetic correction reason'}};
  savePendingContactCorrection(userId,siteId,requestId,correction);
  assert.deepEqual(loadPendingContactCorrection(userId,siteId,requestId).draft,correction);
  clearAccountDrafts(userId);
  assert.equal(loadPendingContactAttempt(userId,siteId,requestId).draft,null);
  assert.equal(loadPendingContactCorrection(userId,siteId,requestId).draft,null);
});
test('malformed pending contact command stays in storage and warns before new action',()=>{
  const userId=randomUUID(),siteId=randomUUID(),requestId=randomUUID(),key=`vmms:request-contact-attempt:v1:${userId}:${siteId}:${requestId}`;
  storage.setItem(key,'{bad json');
  const result=loadPendingContactAttempt(userId,siteId,requestId);
  assert.equal(result.draft,null);
  assert.match(result.error??'',/check contact history/i);
  assert.equal(storage.getItem(key),'{bad json');
});
beforeEach(() => storage.clear());

test("shared-browser sign-out removes every VMMS draft and preserves unrelated tab storage", () => {
  storage.setItem("vmms:draft:v3:user-a:site-a", "draft-a");
  storage.setItem("vmms:evidence-draft:v1:user-b:site-b:work-order", "evidence");
  storage.setItem("vmms:draft:v2:user-c:site-c", "old-draft");
  storage.setItem("other-app:preference", "keep");
  clearAllWorkspaceDrafts();
  assert.equal(storage.getItem("vmms:draft:v3:user-a:site-a"), null);
  assert.equal(storage.getItem("vmms:evidence-draft:v1:user-b:site-b:work-order"), null);
  assert.equal(storage.getItem("vmms:draft:v2:user-c:site-c"), null);
  assert.equal(storage.getItem("other-app:preference"), "keep");
});

function makeEvidenceDraft(savedAt = new Date().toISOString()) {
  return {
    intentId: null,
    intentCommandId: randomUUID(),
    displayName: "synthetic-photo.jpg",
    declaredMediaType: "image/jpeg",
    expectedBytes: 128,
    savedAt,
  };
}

test("evidence recovery is limited to the matching account, site, and work order", () => {
  const userId = randomUUID();
  const siteId = randomUUID();
  const workOrderId = randomUUID();
  const draft = makeEvidenceDraft();

  saveEvidenceDraft(userId, siteId, workOrderId, draft);

  assert.deepEqual(loadEvidenceDraft(userId, siteId, workOrderId), { draft, error: null });
  assert.deepEqual(loadEvidenceDraft(randomUUID(), siteId, workOrderId), { draft: null, error: null });
  assert.deepEqual(loadEvidenceDraft(userId, randomUUID(), workOrderId), { draft: null, error: null });
  assert.deepEqual(loadEvidenceDraft(userId, siteId, randomUUID()), { draft: null, error: null });
});

test("expired evidence recovery details are removed at the eight-hour limit", () => {
  const userId = randomUUID();
  const siteId = randomUUID();
  const workOrderId = randomUUID();
  const key = `vmms:evidence-draft:v1:${userId}:${siteId}:${workOrderId}`;
  const savedAt = new Date(Date.now() - INTAKE_DRAFT_MAX_AGE_MS).toISOString();
  storage.setItem(key, JSON.stringify(makeEvidenceDraft(savedAt)));

  const result = loadEvidenceDraft(userId, siteId, workOrderId);

  assert.equal(result.draft, null);
  assert.match(result.error ?? "", /expired and were removed/i);
  assert.equal(storage.getItem(key), null);
});

test("evidence recovery details with an implausible future save time are removed", () => {
  const userId = randomUUID();
  const siteId = randomUUID();
  const workOrderId = randomUUID();
  const key = `vmms:evidence-draft:v1:${userId}:${siteId}:${workOrderId}`;
  const savedAt = new Date(Date.now() + 10 * 60_000).toISOString();
  storage.setItem(key, JSON.stringify(makeEvidenceDraft(savedAt)));

  const result = loadEvidenceDraft(userId, siteId, workOrderId);

  assert.equal(result.draft, null);
  assert.match(result.error ?? "", /expired and were removed/i);
  assert.equal(storage.getItem(key), null);
});

test("sign-out cleanup removes all draft versions and uploads for one account only", () => {
  const userId = randomUUID();
  const otherUserId = randomUUID();
  const siteId = randomUUID();
  storage.setItem(`vmms:draft:v3:${userId}:${siteId}`, "current intake");
  storage.setItem(`vmms:draft:v2:${userId}:${siteId}`, "older intake");
  storage.setItem(`vmms:draft:v1:${userId}:${siteId}`, "legacy intake");
  storage.setItem(`vmms:evidence-draft:v1:${userId}:${siteId}:${randomUUID()}`, "upload details");
  storage.setItem(`vmms:draft:v3:${otherUserId}:${siteId}`, "another account");
  storage.setItem(`vmms:evidence-draft:v1:${otherUserId}:${siteId}:${randomUUID()}`, "another account upload");

  clearAccountDrafts(userId);

  assert.equal(storage.length, 2);
  assert.ok(storage.getItem(`vmms:draft:v3:${otherUserId}:${siteId}`));
  assert.ok([...Array(storage.length)].some((_, index) => storage.key(index)?.startsWith(`vmms:evidence-draft:v1:${otherUserId}:`)));
});
