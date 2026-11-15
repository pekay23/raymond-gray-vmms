import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import test from 'node:test';
import { S3Client } from '@aws-sdk/client-s3';
import type { Database } from '../src/db.js';
import type { EvidenceServices } from '../src/evidence.js';
import { createEvidenceServices, runEvidenceWorker } from '../src/evidence.js';

const unusedServices: EvidenceServices = {
  store: null,
  scanner: null,
  maxUploadBytes: 1,
  allowedMediaTypes: new Set(),
  close: async () => {},
};

test('evidence service disposal destroys its S3 client once across concurrent close calls', async () => {
  const originalDestroy = S3Client.prototype.destroy;
  let destroyCalls = 0;
  S3Client.prototype.destroy = function () {
    destroyCalls += 1;
    return originalDestroy.call(this);
  };

  try {
    const services = createEvidenceServices({
      VMMS_EVIDENCE_S3_ENDPOINT: 'http://127.0.0.1:9000',
      VMMS_EVIDENCE_S3_BUCKET: 'synthetic-evidence',
      VMMS_EVIDENCE_S3_ACCESS_KEY_ID: 'synthetic-access-key',
      VMMS_EVIDENCE_S3_SECRET_ACCESS_KEY: 'synthetic-secret-key',
      VMMS_EVIDENCE_ALLOWED_MIME_TYPES: 'application/pdf',
      VMMS_EVIDENCE_MAX_UPLOAD_BYTES: '1024',
    });

    await Promise.all([services.close(), services.close(), services.close()]);
    assert.equal(destroyCalls, 1, 'repeated shutdown should destroy the underlying S3 client once');
  } finally {
    S3Client.prototype.destroy = originalDestroy;
  }
});

test('evidence worker logs a sanitized retry event and continues after a transient claim failure', async () => {
  const controller = new AbortController();
  const events: unknown[] = [];
  let closeCalls = 0;
  let calls = 0;
  const pool = {
    async query() {
      calls += 1;
      if (calls === 1) throw new Error('synthetic-password-must-not-be-logged');
      controller.abort();
      return { rows: [] };
    },
  } as unknown as Database;

  await runEvidenceWorker(pool, { ...unusedServices, close: async () => { closeCalls += 1; } }, controller.signal, {
    idleDelayMs: 0,
    errorDelayMs: 0,
    onError: (event) => events.push(event),
  });

  assert.equal(calls, 2, 'the worker should continue after the first transient failure');
  assert.deepEqual(events, [{ event: 'evidence.scan-worker.loop-failed', retryInMs: 0 }]);
  assert.equal(JSON.stringify(events).includes('synthetic-password'), false, 'raw errors must never reach the log sink');
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0, 'worker shutdown should release abort listeners');
  assert.equal(closeCalls, 1, 'worker shutdown should dispose its service bundle once');
});

test('evidence worker exits promptly when shutdown arrives during its idle wait', async () => {
  const controller = new AbortController();
  let calls = 0;
  let closeCalls = 0;
  const pool = {
    async query() {
      calls += 1;
      return { rows: [] };
    },
  } as unknown as Database;

  const shutdown = setTimeout(() => controller.abort(), 10);
  await runEvidenceWorker(pool, { ...unusedServices, close: async () => { closeCalls += 1; } }, controller.signal, { idleDelayMs: 1000 });
  clearTimeout(shutdown);

  assert.equal(calls, 1, 'shutdown during the idle wait should stop the next polling iteration');
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0, 'completed waits should not retain abort listeners');
  assert.equal(closeCalls, 1, 'worker shutdown should dispose its service bundle once');
});

test('evidence worker disposes its service bundle when the retry logger fails', async () => {
  const controller = new AbortController();
  let closeCalls = 0;
  const loggerFailure = new Error('synthetic log sink failure');
  const pool = {
    async query() { throw new Error('synthetic provider failure'); },
  } as unknown as Database;

  await assert.rejects(
    runEvidenceWorker(pool, { ...unusedServices, close: async () => { closeCalls += 1; } }, controller.signal, {
      onError: () => { throw loggerFailure; },
    }),
    (error) => error === loggerFailure,
  );

  assert.equal(closeCalls, 1, 'unexpected loop exit should still dispose the service bundle');
});
