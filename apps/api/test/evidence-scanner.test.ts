import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { createEvidenceServices } from '../src/evidence.js';
import { startClamAvFixture, type ClamAvFixtureMode } from './support/clamav-fixture.js';

const sample = Buffer.from('synthetic evidence scanner fixture');

async function openScanner(mode: ClamAvFixtureMode) {
  const fixture = await startClamAvFixture(mode);
  const services = createEvidenceServices({
    VMMS_EVIDENCE_CLAMAV_HOST: fixture.host,
    VMMS_EVIDENCE_CLAMAV_PORT: String(fixture.port),
    VMMS_EVIDENCE_CLAMAV_TIMEOUT_MS: '1000',
  });
  assert(services.scanner, 'The configured loopback scanner should be available.');

  return {
    scanner: services.scanner,
    async close() {
      await services.close();
      await fixture.close();
    },
  };
}

function inputStream() {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(sample));
      controller.close();
    },
  });
}

for (const mode of ['version-timeout', 'scan-timeout', 'slow-trickle', 'malformed', 'oversized', 'truncated', 'close'] as const) {
  test(`ClamAV ${mode} returns an unavailable verdict`, async () => {
    const testScanner = await openScanner(mode);
    try {
      const verdict = await testScanner.scanner.scan(inputStream());
      assert.equal(verdict.kind, 'unavailable');
      assert.equal(
        verdict.detailCode,
        mode === 'malformed' ? 'scanner-protocol-error' : 'scanner-unavailable',
      );
    } finally {
      await testScanner.close();
    }
  });
}

test('ClamAV clean verdict includes the digest of the exact streamed bytes', async () => {
  const testScanner = await openScanner('clean');
  try {
    const verdict = await testScanner.scanner.scan(inputStream());
    assert.equal(verdict.kind, 'clean');
    if (verdict.kind !== 'clean') return;
    assert.equal(verdict.sha256, createHash('sha256').update(sample).digest('hex'));
    assert.equal(verdict.version, 'ClamAV synthetic test');
  } finally {
    await testScanner.close();
  }
});

test('ClamAV total scan deadline cancels a stalled quarantine input stream', async () => {
  const testScanner = await openScanner('scan-timeout');
  let cancelled = false;
  const stalledInput = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(sample));
    },
    cancel() {
      cancelled = true;
    },
  });
  try {
    const verdict = await testScanner.scanner.scan(stalledInput);
    assert.equal(verdict.kind, 'unavailable');
    assert.equal(verdict.detailCode, 'scanner-unavailable');
    assert.equal(cancelled, true);
  } finally {
    await testScanner.close();
  }
});

test('ClamAV timeout configuration is bounded', () => {
  assert.throws(() => createEvidenceServices({
    VMMS_EVIDENCE_CLAMAV_HOST: '127.0.0.1',
    VMMS_EVIDENCE_CLAMAV_PORT: '13310',
    VMMS_EVIDENCE_CLAMAV_TIMEOUT_MS: '999',
  }), /too_small/);
  assert.throws(() => createEvidenceServices({
    VMMS_EVIDENCE_CLAMAV_HOST: '127.0.0.1',
    VMMS_EVIDENCE_CLAMAV_PORT: '13310',
    VMMS_EVIDENCE_CLAMAV_TIMEOUT_MS: '60001',
  }), /too_big/);
});
