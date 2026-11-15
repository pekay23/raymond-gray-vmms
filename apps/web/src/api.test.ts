import assert from "node:assert/strict";
import { test } from "node:test";
import { request } from "./api.js";
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
