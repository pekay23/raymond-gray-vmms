import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError } from '../src/errors.js';
import { requirePilotModule, type PilotModule } from '../src/pilot-modules.js';

test('Sales and Finance setup remain available to isolated tests only', () => {
  const modules: PilotModule[] = ['sales', 'finance-setup'];
  for (const module of modules) {
    assert.equal(requirePilotModule(module, 'test'), undefined);
    for (const mode of ['development', 'staging', 'production'] as const) {
      assert.throws(() => requirePilotModule(module, mode), (error: unknown) =>
        error instanceof ApiError && error.status === 404 && error.code === 'FEATURE_UNAVAILABLE');
    }
  }
});
