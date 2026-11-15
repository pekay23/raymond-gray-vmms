import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { emptyIntake, INTAKE_DRAFT_MAX_AGE_MS, loadDraft } from "../apps/web/src/drafts.ts";

class TestStorage {
  values = new Map();
  failNextWrite = false;
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) {
    if (this.failNextWrite) {
      this.failNextWrite = false;
      throw new DOMException("Synthetic storage quota failure", "QuotaExceededError");
    }
    this.values.set(key, String(value));
  }
  removeItem(key) { this.values.delete(key); }
}

const storage = new TestStorage();
globalThis.sessionStorage = storage;
const userId = randomUUID();
const siteId = randomUUID();
const now = new Date().toISOString();
const v2Key = `vmms:draft:v2:${userId}:${siteId}`;
const v3Key = `vmms:draft:v3:${userId}:${siteId}`;
const v2Draft = {
  draftId: randomUUID(),
  commandId: randomUUID(),
  fields: { ...emptyIntake, powertrainClass: "EV", clientName: "Synthetic client" },
  savedAt: now,
};
storage.values.set(v2Key, JSON.stringify(v2Draft));
storage.failNextWrite = true;
const failedV2 = loadDraft(userId, siteId);
assert.equal(failedV2.draft, null);
assert.match(failedV2.error ?? "", /storage is unavailable/i);
assert.notEqual(storage.getItem(v2Key), null, "v2 source draft must survive a failed v3 write");
const migratedV2 = loadDraft(userId, siteId);
assert.equal(migratedV2.draft?.fields.clientName, "Synthetic client");
assert.equal(migratedV2.draft?.fields.powertrainClass, "");
assert.equal(migratedV2.draft?.clientSelectionNeedsReview, true);
assert.equal(migratedV2.draft?.vehicleSelectionNeedsReview, true);
assert.equal(storage.getItem(v2Key), null, "remove v2 only after the v3 copy is written");

storage.removeItem(v3Key);
const v1Key = `vmms:draft:v1:${userId}:${siteId}`;
storage.values.set(v1Key, JSON.stringify({
  draftId: randomUUID(),
  commandId: randomUUID(),
  savedAt: now,
  fields: {
    customerName: "Synthetic visit contact",
    phone: "",
    email: "",
    vin: "",
    registration: "",
    make: "",
    model: "",
    variant: "",
    powertrain: "",
    odometerKm: "",
    socPercent: "",
    complaint: "Synthetic older entry",
  },
}));
storage.failNextWrite = true;
const failedV1 = loadDraft(userId, siteId);
assert.equal(failedV1.draft, null);
assert.notEqual(storage.getItem(v1Key), null, "v1 source draft must survive a failed v3 write");
const migratedV1 = loadDraft(userId, siteId);
assert.equal(migratedV1.draft?.fields.visitContactName, "Synthetic visit contact");
assert.equal(migratedV1.draft?.fields.complaint, "Synthetic older entry");
assert.equal(migratedV1.draft?.clientSelectionNeedsReview, true);
assert.equal(migratedV1.draft?.vehicleSelectionNeedsReview, true);
assert.equal(storage.getItem(v1Key), null, "remove v1 only after the v3 copy is written");
storage.removeItem(v3Key);
storage.values.set(v3Key, JSON.stringify({ ...v2Draft, fields: { ...v2Draft.fields, powertrainClass: "EV" } }));
storage.failNextWrite = true;
const failedV3 = loadDraft(userId, siteId);
assert.equal(failedV3.draft, null);
assert.notEqual(storage.getItem(v3Key), null, "older v3 draft must remain available when its review state cannot be saved");
const recoveredV3 = loadDraft(userId, siteId);
assert.equal(recoveredV3.draft?.clientSelectionNeedsReview, true);
assert.equal(recoveredV3.draft?.vehicleSelectionNeedsReview, true);
assert.equal(recoveredV3.draft?.fields.clientName, "Synthetic client");
assert.ok(INTAKE_DRAFT_MAX_AGE_MS > 0);
process.stdout.write("Verified v1, v2 and legacy v3 drafts retain their data and require record-selection review after migration.\n");
