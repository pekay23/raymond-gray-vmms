import assert from "node:assert/strict";
import { test } from "node:test";
import { checklistItemReviewPath, checklistItemReviewResultSchema, checklistReviewQueuePath, checklistReviewQueueSchema, request, taskReviewQueuePath, taskReviewQueueSchema, workOrderChecklistReportPath, workOrderChecklistReportSchema, workOrderChecklistsSchema } from "./api.js";
import { z } from "zod";

const responseSchema = z.object({ ok: z.boolean() });

async function expiredEventFor(path: string) {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const events: string[] = [];
  const target = new EventTarget();
  for (const name of ["vmms-session-expired", "vmms-owner-session-expired"])
    target.addEventListener(name, () => events.push(name));
  Object.defineProperty(globalThis, "window", { configurable: true, value: target });
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: "Expired", code: "unauthorized" } }), { status: 401 });
  try {
    await assert.rejects(request(path, responseSchema));
    return events;
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) delete (globalThis as { window?: Window }).window;
    else Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  }
}

test("owner 401 expires only the owner session", async () => {
  assert.deepEqual(await expiredEventFor("/owner/vehicles"), ["vmms-owner-session-expired"]);
});

test("staff 401 expires only the staff session", async () => {
  assert.deepEqual(await expiredEventFor("/sites/site/work-orders"), ["vmms-session-expired"]);
});

test("session bootstrap 401 does not emit an expiry event", async () => {
  assert.deepEqual(await expiredEventFor("/owner/session"), []);
  assert.deepEqual(await expiredEventFor("/session"), []);
});

test("work-order checklist response is limited to routine maintenance", () => {
  const base = {
    workOrderId: "10000000-0000-4000-8000-000000000001",
    workOrderVersion: 1,
    vehicle: { make: "Example", model: "Touring", variant: "Long Range", powertrain: "BEV" },
    checklists: [], availableTemplates: [], canPrepare:false, prepareBlockReason:"authority-required", unavailableReason: "No approved checklist.",
    pagination: { page: 1, pageSize: 25, totalItems: 0, totalPages: 0 },
  };
  assert.equal(workOrderChecklistsSchema.safeParse(base).success, true);
  assert.equal(workOrderChecklistsSchema.safeParse({
    ...base,
    availableTemplates: [{
      id: "30000000-0000-4000-8000-000000000001", code: "EXAMPLE", revision: 1,
      kind: "pdi", make: "Example", model: "Touring", variant: "Long Range", powertrain: "BEV",
      effectiveFrom: "2026-11-17T10:00:00.000Z",
    }],
  }).success, false);
  assert.equal(workOrderChecklistsSchema.safeParse({
    ...base,
    checklists: [{
      id: "20000000-0000-4000-8000-000000000002", kind: "routine-maintenance", state: "draft", version: 1,
      scheduleBasis: "delivery-inspection", templateCode:"MAINT", templateRevision:1, templateRevisionId:"30000000-0000-4000-8000-000000000002", odometerAtStartKm: null, createdAt: "2026-11-17T10:00:00.000Z",
    }],
  }).success, false);
});

test("maintenance report path pins later pages to the checklist version", () => {
  assert.equal(workOrderChecklistReportPath("site/1", "order 1", "checklist/1", 2, 50, 4),
    "/sites/site%2F1/work-orders/order%201/checklists/checklist%2F1/report?page=2&pageSize=50&expectedChecklistVersion=4");
  assert.equal(workOrderChecklistReportPath("site", "order", "checklist"),
    "/sites/site/work-orders/order/checklists/checklist/report?page=1&pageSize=50");
});

test("maintenance report schema requires reasons and reports saved items only", () => {
  const report = {
    workOrderId: "10000000-0000-4000-8000-000000000001", bookingReference: "EV-SR-00001", siteName: "Synthetic site",
    vehicle: { registration: "SYN-001", make: "Example", model: "Touring", variant: "Long Range", powertrain: "BEV" },
    checklist: { id: "20000000-0000-4000-8000-000000000002", kind: "routine-maintenance", state: "draft", version: 1,
      scheduleBasis: "unknown", odometerAtStartKm: null, templateCode: "MAINT-EXAMPLE", templateRevision: 1, sources: [] },
    summary: { totalItems: 1, completed: 0, failed: 0, notChecked: 1, notCompleted: 0, blocked: 0, notApplicable: 0 },
    items: [{ id: "30000000-0000-4000-8000-000000000003", code: "check-1", ordinal: 1, label: "Synthetic inspection item", result: null,
      reason: null, applicabilityReason: null, comments: null, measurement: null, actorName: null, assigneeName: null,
      taskReference: null, taskTitle: null, revision: null, correctionReason: null, recordedAt: null, evidenceLabels: [] }],
    pagination: { page: 1, pageSize: 50, totalItems: 1, totalPages: 1 }, preparedAt: "2026-11-18T10:00:00.000Z",
  };
  assert.equal(workOrderChecklistReportSchema.safeParse(report).success, true);
  assert.equal(workOrderChecklistReportSchema.safeParse({ ...report, checklist: { ...report.checklist, kind: "pdi" } }).success, false);
  assert.equal(workOrderChecklistReportSchema.safeParse({ ...report, items: [{ ...report.items[0], result: "blocked", reason: null }] }).success, false);
});

test("task review queue path and schema keep request links tied to current work orders", () => {
  assert.equal(taskReviewQueuePath("site/1", 2, 5), "/sites/site%2F1/task-review-requests?page=2&pageSize=5");
  const queue = {
    items: [{ activityId: "10000000-0000-4000-8000-000000000001", workOrderId: "20000000-0000-4000-8000-000000000001",
      bookingReference: "EV-SR-00001", vehicleLabel: "Example Touring", registration: "SYN-001",
      taskId: "30000000-0000-4000-8000-000000000001", taskReference: "T01", taskTitle: "Inspect vehicle",
      technicianName: "Synthetic Technician", requesterName: "Synthetic Technician", note: "Please review this task.", createdAt: "2026-11-18T10:00:00.000Z" }],
    pagination: { page: 1, pageSize: 10, totalItems: 1, totalPages: 1 },
  };
  assert.equal(taskReviewQueueSchema.safeParse(queue).success, true);
  assert.equal(taskReviewQueueSchema.safeParse({ ...queue, items: [{ ...queue.items[0], internalEvidenceKey: "private" }] }).success, false);
});

test("checklist review links bind decisions to the exact item and expose only approved queue fields", () => {
  assert.equal(checklistReviewQueuePath("site/1", 2, 5), "/sites/site%2F1/checklist-review-queue?page=2&pageSize=5");
  const ids = { workOrderId: "10000000-0000-4000-8000-000000000001", taskId: "20000000-0000-4000-8000-000000000001", checklistId: "30000000-0000-4000-8000-000000000001", itemId: "40000000-0000-4000-8000-000000000001", outcomeRevisionId: "50000000-0000-4000-8000-000000000001", workPlanRevisionId: "60000000-0000-4000-8000-000000000001" };
  const item = { ...ids, bookingReference: "EV-SR-00001", vehicleLabel: "Example Touring", registration: "SYN-001", taskReference: "T01", taskTitle: "Inspect vehicle", checklistVersion: 3, itemCode: "BRAKE-01", itemLabel: "Brake check", outcomeRevision: 1, result: "failed", reason: "A fault was observed.", comments: null, measurement: null, evidence: [], evidenceRequired: false, evidenceCurrent: false, hasOpenHold: false, technicianName: "Synthetic Technician", recordedAt: "2026-11-19T10:00:00.000Z", assignmentRevision: 2 };
  const queue = { canReview: true, blockReason: null, items: [item], pagination: { page: 1, pageSize: 10, totalItems: 1, totalPages: 1 } };
  assert.equal(checklistReviewQueueSchema.safeParse(queue).success, true);
  assert.equal(checklistReviewQueueSchema.safeParse({ ...queue, items: [{ ...item, evidenceKey: "private-storage-key" }] }).success, false);
  assert.equal(checklistItemReviewPath("site/1", item), "/sites/site%2F1/work-orders/10000000-0000-4000-8000-000000000001/tasks/20000000-0000-4000-8000-000000000001/checklists/30000000-0000-4000-8000-000000000001/items/40000000-0000-4000-8000-000000000001/reviews");
  assert.equal(checklistItemReviewResultSchema.safeParse({ reviewId: ids.outcomeRevisionId, workOrderId: ids.workOrderId, checklistId: ids.checklistId, itemId: ids.itemId, outcomeRevisionId: ids.outcomeRevisionId, disposition: "record-confirmed", checklistVersion: 3, reviewedAt: "2026-11-19T10:00:00.000Z" }).success, true);
});
