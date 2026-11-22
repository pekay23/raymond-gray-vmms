import assert from 'node:assert/strict';
import test from 'node:test';
import { checklistItemReviewInputSchema, checklistItemReviewResultSchema, checklistReviewQueueSchema } from '../src/work-order-checklist-reviews.js';

const base = {
  expectedChecklistVersion: 3,
  expectedWorkPlanRevisionId: '10000000-0000-4000-8000-000000000001',
  expectedAssignmentRevision: 2,
  outcomeRevisionId: '20000000-0000-4000-8000-000000000001',
  disposition: 'record-confirmed' as const,
  reason: 'The entry is supported by the saved inspection record.',
};

test('checklist record review requires a version-bound outcome and reason', () => {
  assert.equal(checklistItemReviewInputSchema.parse(base).disposition, 'record-confirmed');
  assert.equal(checklistItemReviewInputSchema.parse({ ...base, disposition: 'returned-for-correction' }).disposition, 'returned-for-correction');
  assert.equal(checklistItemReviewInputSchema.safeParse({ ...base, reason: '   ' }).success, false);
  assert.equal(checklistItemReviewInputSchema.safeParse({ ...base, expectedAssignmentRevision: 0 }).success, false);
  assert.equal(checklistItemReviewInputSchema.safeParse({ ...base, extra: true }).success, false);
});

test('checklist record review result is separate from checklist and work completion states', () => {
  const result = checklistItemReviewResultSchema.parse({
    reviewId: '30000000-0000-4000-8000-000000000001',
    workOrderId: '40000000-0000-4000-8000-000000000001',
    checklistId: '50000000-0000-4000-8000-000000000001',
    itemId: '60000000-0000-4000-8000-000000000001',
    outcomeRevisionId: base.outcomeRevisionId,
    disposition: 'record-confirmed',
    checklistVersion: 3,
    reviewedAt: '2026-11-19T10:00:00.000Z',
  });
  assert.equal('taskCompleted' in result, false);
  assert.equal('checklistState' in result, false);
  assert.equal('released' in result, false);
});

test('review queue explicitly exposes missing review authority without returning records', () => {
  assert.deepEqual(checklistReviewQueueSchema.parse({
    canReview: false,
    blockReason: 'authority-required',
    items: [],
    pagination: { page: 1, pageSize: 10, totalItems: 0, totalPages: 0 },
  }).items, []);
});
