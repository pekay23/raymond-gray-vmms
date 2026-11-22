import assert from 'node:assert/strict';
import test from 'node:test';
import { workOrderChecklistsSchema } from '../src/work-order-checklists.js';

const response = {
  workOrderId: '10000000-0000-4000-8000-000000000001',
  workOrderVersion: 1,
  vehicle: { make: 'Example', model: 'Touring', variant: 'Long Range', powertrain: 'BEV' },
  checklists: [],
  availableTemplates: [],
  canPrepare: false,
  prepareBlockReason: 'authority-required',
  unavailableReason: 'No current approved checklist was found for this exact vehicle configuration. Do not use a generic checklist.',
  pagination: { page: 1, pageSize: 25, totalItems: 0, totalPages: 0 },
};

test('work-order checklist projection accepts routine maintenance only', () => {
  assert.equal(workOrderChecklistsSchema.safeParse(response).success, true);
  assert.equal(workOrderChecklistsSchema.safeParse({
    ...response,
    checklists: [{
      id: '20000000-0000-4000-8000-000000000001', kind: 'pdi', state: 'draft', version: 1,
      scheduleBasis: 'unknown', templateCode: 'PDI', templateRevision: 1, templateRevisionId: '30000000-0000-4000-8000-000000000001', odometerAtStartKm: null, createdAt: '2026-11-17T10:00:00.000Z',
    }],
  }).success, false);
  assert.equal(workOrderChecklistsSchema.safeParse({
    ...response,
    checklists: [{
      id: '20000000-0000-4000-8000-000000000002', kind: 'routine-maintenance', state: 'draft', version: 1,
      scheduleBasis: 'delivery-inspection', templateCode: 'MAINT', templateRevision: 1, templateRevisionId: '30000000-0000-4000-8000-000000000002', odometerAtStartKm: null, createdAt: '2026-11-17T10:00:00.000Z',
    }],
  }).success, false);
  assert.equal(workOrderChecklistsSchema.safeParse({
    ...response,
    availableTemplates: [{
      id: '30000000-0000-4000-8000-000000000001', code: 'EXAMPLE', revision: 1,
      kind: 'pdi', make: 'Example', model: 'Touring', variant: 'Long Range', powertrain: 'BEV',
      effectiveFrom: '2026-11-17T10:00:00.000Z',
    }],
  }).success, false);
});
