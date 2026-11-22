import assert from "node:assert/strict";
import test from "node:test";
import { formatCurrency, formatCurrencyMinorUnits, parseCurrencyAmountToMinorUnits, formatDateTime, instantToSiteDateTimeInput, siteDateTimeInputToInstant } from "./formatting.js";

test("site timestamps use Accra time and accept an explicit site timezone", () => {
  const timestamp = "2026-01-01T00:30:00Z";
  assert.equal(formatDateTime(timestamp), "1 Jan 2026, 12:30 am");
  assert.equal(formatDateTime(timestamp, "America/New_York"), "31 Dec 2025, 7:30 pm");
  assert.equal(formatDateTime("not a timestamp"), "Time unavailable");
  assert.throws(() => formatDateTime(timestamp, "Not/A_Timezone"), RangeError);
});

test("service-centre date and time inputs become correct instants across timezones", () => {
  assert.equal(siteDateTimeInputToInstant("2026-12-01T14:00", "Africa/Accra"), "2026-12-01T14:00:00.000Z");
  assert.equal(siteDateTimeInputToInstant("2026-12-01T14:00", "America/New_York"), "2026-12-01T19:00:00.000Z");
  assert.throws(() => siteDateTimeInputToInstant("2026-03-08T02:30", "America/New_York"), /does not exist/);
  assert.throws(() => siteDateTimeInputToInstant("2026-11-01T01:30", "America/New_York"), /occurs twice/);
  assert.throws(() => siteDateTimeInputToInstant("2026-02-30T14:00", "Africa/Accra"), /valid service-centre/);
  assert.equal(instantToSiteDateTimeInput("2026-12-01T19:00:00Z", "America/New_York"), "2026-12-01T14:00");
  assert.equal(instantToSiteDateTimeInput("2026-11-01T06:30:00Z", "America/New_York"), "2026-11-01T01:30");
});

test("currency formatting uses the explicit ISO currency's customary precision", () => {
  assert.equal(formatCurrency(1234.5, "GHS"), "GH₵1,234.50");
  assert.equal(formatCurrency(1234.5, "USD"), "US$1,234.50");
  assert.equal(formatCurrency(1234, "JPY"), "JP¥1,234");
  assert.equal(formatCurrency(-12.5, "EUR"), "-€12.50");
  assert.doesNotThrow(() => formatCurrency(1, "XCG"));
});

test("formatting does not require Intl.supportedValuesOf at runtime", () => {
  const original = Intl.supportedValuesOf;
  Object.defineProperty(Intl, "supportedValuesOf", { configurable: true, value: undefined });
  try {
    assert.equal(formatDateTime("2026-01-01T00:30:00Z"), "1 Jan 2026, 12:30 am");
    assert.equal(formatCurrency(1, "GHS"), "GH₵1.00");
  } finally {
    Object.defineProperty(Intl, "supportedValuesOf", { configurable: true, value: original });
  }
});

test("currency formatting rejects ambiguous or non-finite money values", () => {
  assert.throws(() => formatCurrency(100, "ghs"), /uppercase ISO 4217 code/);
  assert.throws(() => formatCurrency(100, "ZZZ"), RangeError);
  assert.throws(() => formatCurrency(100, "XXX"), RangeError);
  assert.throws(() => formatCurrency(Number.NaN, "GHS"), /finite number/);
  assert.throws(() => formatCurrency(Number.POSITIVE_INFINITY, "GHS"), /finite number/);
});

test("manual estimates convert decimal amounts to exact currency minor units", () => {
  assert.equal(parseCurrencyAmountToMinorUnits("1234.5", "GHS"), "123450");
  assert.equal(parseCurrencyAmountToMinorUnits("1234", "JPY"), "1234");
  assert.equal(parseCurrencyAmountToMinorUnits("1.234", "KWD"), "1234");
  assert.equal(formatCurrencyMinorUnits("123450", "GHS"), "GH₵1,234.50");
  assert.equal(formatCurrencyMinorUnits("1234", "JPY"), "JP¥1,234");
  assert.throws(() => parseCurrencyAmountToMinorUnits("1.001", "GHS"), /decimal places/);
  assert.throws(() => parseCurrencyAmountToMinorUnits("-1", "GHS"), /non-negative amount/);
  assert.throws(() => parseCurrencyAmountToMinorUnits("01.00", "GHS"), /non-negative amount/);
});
