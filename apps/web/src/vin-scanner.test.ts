import assert from "node:assert/strict";
import test from "node:test";
import { normalizeScannedVin } from "./vin-scanner.tsx";

test("VIN scanner normalizes valid barcode values for review", () => {
  assert.equal(normalizeScannedVin(" 1HGCM82633A004352 "), "1HGCM82633A004352");
  assert.equal(normalizeScannedVin("1hgcm82633a004352"), "1HGCM82633A004352");
});

test("VIN scanner rejects malformed values and forbidden VIN letters", () => {
  assert.equal(normalizeScannedVin("1HGCM82633A00435"), null);
  assert.equal(normalizeScannedVin("1HGCM82633A00435I"), null);
  assert.equal(normalizeScannedVin("1HGCM82633A00435O"), null);
  assert.equal(normalizeScannedVin("1HGCM82633A00435Q"), null);
  assert.equal(normalizeScannedVin("not a vehicle code"), null);
});
