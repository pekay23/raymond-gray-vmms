import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addMoney,
  moneyInputSchema,
  serializeMoney,
  subtractMoney,
  validatePaymentAllocation,
} from '../src/commercial-money.js';

const money = (minorUnits: string, currency = 'GHS') => moneyInputSchema.parse({ minorUnits, currency });

test('money parses exact bounded minor units and serializes without bigint', () => {
  const amount = money('90071992547409931234567890');
  assert.equal(amount.minorUnits, 90071992547409931234567890n);
  assert.deepEqual(serializeMoney(amount), { minorUnits: '90071992547409931234567890', currency: 'GHS' });
  assert.deepEqual(JSON.parse(JSON.stringify(serializeMoney(amount))), {
    minorUnits: '90071992547409931234567890', currency: 'GHS',
  });
});

test('money rejects decimals, signs, leading zeroes, oversized values and unconfigured-looking currency syntax', () => {
  for (const minorUnits of ['-1', '+1', '1.25', '01', '', '1'.repeat(39)]) {
    assert.equal(moneyInputSchema.safeParse({ minorUnits, currency: 'GHS' }).success, false, minorUnits);
  }
  for (const currency of ['ghs', 'US', 'USDD', '1HS']) {
    assert.equal(moneyInputSchema.safeParse({ minorUnits: '1', currency }).success, false, currency);
  }
});

test('money arithmetic is exact and rejects currency mismatch and negative balances', () => {
  const sum = addMoney(money('9007199254740993'), money('7'));
  assert.equal(sum.ok, true);
  if (sum.ok) assert.deepEqual(serializeMoney(sum.value), { minorUnits: '9007199254741000', currency: 'GHS' });

  assert.deepEqual(addMoney(money('1', 'GHS'), money('1', 'USD')), { ok: false, error: 'currency-mismatch' });
  assert.deepEqual(addMoney(money('9'.repeat(38)), money('1')), { ok: false, error: 'amount-out-of-range' });
  assert.deepEqual(subtractMoney(money('2'), money('3')), { ok: false, error: 'negative-balance' });
  const remaining = subtractMoney(money('5'), money('3'));
  assert.equal(remaining.ok, true);
  if (remaining.ok) assert.equal(serializeMoney(remaining.value).minorUnits, '2');
});

test('payment allocations cannot exceed verified funds or invoice total', () => {
  const base = {
    verifiedPayment: money('1000'),
    allocatedFromPayment: money('200'),
    invoiceTotal: money('1500'),
    alreadyAllocatedToInvoice: money('500'),
    proposed: money('400'),
  };
  assert.equal(validatePaymentAllocation(base).ok, true);
  assert.deepEqual(validatePaymentAllocation({ ...base, proposed: money('801') }), {
    ok: false, error: 'payment-over-allocated',
  });
  assert.deepEqual(validatePaymentAllocation({ ...base, proposed: money('1001') }), {
    ok: false, error: 'payment-over-allocated',
  });
  assert.deepEqual(validatePaymentAllocation({
    ...base,
    verifiedPayment: money('2000'),
    allocatedFromPayment: money('0'),
    proposed: money('1001'),
  }), {
    ok: false, error: 'invoice-over-allocated',
  });
  assert.deepEqual(validatePaymentAllocation({ ...base, proposed: money('0') }), {
    ok: false, error: 'non-positive-allocation',
  });
  assert.deepEqual(validatePaymentAllocation({ ...base, proposed: money('10', 'USD') }), {
    ok: false, error: 'currency-mismatch',
  });
});
