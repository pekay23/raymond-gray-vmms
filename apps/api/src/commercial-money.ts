import { z } from 'zod';

const currencyCodeSchema = z.string().regex(/^[A-Z]{3}$/).brand<'CurrencyCode'>();
const nonNegativeMinorUnitsSchema = z.bigint().refine(value => value >= 0n).brand<'NonNegativeMinorUnits'>();
const minorUnitsSchema = z.string().regex(/^(0|[1-9][0-9]{0,37})$/)
  .transform(value => BigInt(value))
  .pipe(nonNegativeMinorUnitsSchema);

/** JSON uses decimal strings; calculations use bigint and never pass through floating point. */
export const moneyInputSchema = z.object({
  minorUnits: minorUnitsSchema,
  currency: currencyCodeSchema,
}).strict();

export type Money = z.infer<typeof moneyInputSchema>;
export type MoneyInput = z.input<typeof moneyInputSchema>;
export type MoneyResult<T> = { ok: true; value: T } | { ok: false; error: MoneyError };
export type MoneyError =
  | 'amount-out-of-range'
  | 'currency-mismatch'
  | 'negative-balance'
  | 'non-positive-allocation'
  | 'payment-over-allocated'
  | 'invoice-over-allocated';

function makeMoney(minorUnits: bigint, currency: Money['currency']): Money {
  return { minorUnits: nonNegativeMinorUnitsSchema.parse(minorUnits), currency };
}

export function serializeMoney(value: Money): MoneyInput {
  return { minorUnits: value.minorUnits.toString(), currency: value.currency };
}

export function addMoney(left: Money, right: Money): MoneyResult<Money> {
  if (left.currency !== right.currency) return { ok: false, error: 'currency-mismatch' };
  const sum = moneyInputSchema.safeParse({ minorUnits: (left.minorUnits + right.minorUnits).toString(), currency: left.currency });
  if (!sum.success) return { ok: false, error: 'amount-out-of-range' };
  return { ok: true, value: sum.data };
}

export function subtractMoney(left: Money, right: Money): MoneyResult<Money> {
  if (left.currency !== right.currency) return { ok: false, error: 'currency-mismatch' };
  const remaining = left.minorUnits - right.minorUnits;
  if (remaining < 0n) return { ok: false, error: 'negative-balance' };
  return { ok: true, value: makeMoney(remaining, left.currency) };
}

export type AllocationCheck = {
  verifiedPayment: Money;
  allocatedFromPayment: Money;
  invoiceTotal: Money;
  alreadyAllocatedToInvoice: Money;
  proposed: Money;
};

/** Validate one allocation against both source payment and invoice balance. */
export function validatePaymentAllocation(input: AllocationCheck): MoneyResult<Money> {
  const { verifiedPayment, allocatedFromPayment, invoiceTotal, alreadyAllocatedToInvoice, proposed } = input;
  const currencies = [
    verifiedPayment.currency,
    allocatedFromPayment.currency,
    invoiceTotal.currency,
    alreadyAllocatedToInvoice.currency,
    proposed.currency,
  ];
  if (currencies.some(currency => currency !== currencies[0])) return { ok: false, error: 'currency-mismatch' };
  if (proposed.minorUnits <= 0n) return { ok: false, error: 'non-positive-allocation' };
  const paymentAfter = allocatedFromPayment.minorUnits + proposed.minorUnits;
  if (paymentAfter > verifiedPayment.minorUnits) return { ok: false, error: 'payment-over-allocated' };
  const invoiceAfter = alreadyAllocatedToInvoice.minorUnits + proposed.minorUnits;
  if (invoiceAfter > invoiceTotal.minorUnits) return { ok: false, error: 'invoice-over-allocated' };
  return { ok: true, value: makeMoney(proposed.minorUnits, proposed.currency) };
}
