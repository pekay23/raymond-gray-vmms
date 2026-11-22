import { ISO_4217_CURRENCY_CODES } from "./currency-codes.js";

export const DEFAULT_FORMAT_LOCALE = "en-GH";
export const DEFAULT_SITE_TIME_ZONE = "Africa/Accra";
const supportedCurrencies = new Set<string>(ISO_4217_CURRENCY_CODES);

export function siteDateTimeInputToInstant(value: string, timeZone: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) throw new RangeError("Enter a valid service-centre date and time.");
  const parts = match.slice(1).map(part => Number(part ?? 0));
  const [year, month, day, hour, minute, second] = parts as [number, number, number, number, number, number];
  const nominal = Date.UTC(year, month - 1, day, hour, minute, second);
  const check = new Date(nominal);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() + 1 !== month || check.getUTCDate() !== day || hour > 23 || minute > 59 || second > 59) {
    throw new RangeError("Enter a valid service-centre date and time.");
  }
  const formatter = new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  const localParts = (instant: number) => Object.fromEntries(formatter.formatToParts(new Date(instant)).filter(part => part.type !== "literal").map(part => [part.type, Number(part.value)]));
  const target = `${year}-${month}-${day}-${hour}-${minute}-${second}`;
  const matches: number[] = [];
  const offsets = new Set<number>();
  for (let delta = -36; delta <= 36; delta += 6) {
    const sample = nominal + delta * 60 * 60 * 1000;
    const p = localParts(sample);
    const represented = Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!);
    offsets.add(represented - Math.floor(sample / 1000) * 1000);
  }
  for (const offset of offsets) {
    const candidate = nominal - offset;
    const p = localParts(candidate);
    if (`${p.year}-${p.month}-${p.day}-${p.hour}-${p.minute}-${p.second}` === target) matches.push(candidate);
  }
  if (matches.length !== 1) throw new RangeError(matches.length ? "This service-centre time occurs twice because clocks change. Choose a different time." : "This service-centre time does not exist because clocks change. Choose a different time.");
  return new Date(matches[0]!).toISOString();
}

export function instantToSiteDateTimeInput(value: string, timeZone: string): string {
  const instant = new Date(value);
  if (Number.isNaN(instant.valueOf())) throw new RangeError("The recorded time is unavailable.");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(instant);
  const values = Object.fromEntries(parts.filter(part => part.type !== "literal").map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
}

export function formatDateTime(
  value: string,
  timeZone = DEFAULT_SITE_TIME_ZONE,
  locale = DEFAULT_FORMAT_LOCALE,
) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return "Time unavailable";
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(parsed);
}

export function formatCurrency(
  amount: number,
  currency: string,
  locale = DEFAULT_FORMAT_LOCALE,
) {
  if (!Number.isFinite(amount)) {
    throw new RangeError("Currency amount must be a finite number.");
  }
  if (
    !/^[A-Z]{3}$/.test(currency) ||
    currency === "XXX" ||
    !supportedCurrencies.has(currency)
  ) {
    throw new RangeError("Currency must be a supported uppercase ISO 4217 code.");
  }
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
  }).format(amount);
}

export function currencyMinorUnitDigits(currency: string, locale = DEFAULT_FORMAT_LOCALE): number {
  if (!/^[A-Z]{3}$/.test(currency) || currency === "XXX" || !supportedCurrencies.has(currency)) {
    throw new RangeError("Currency must be a supported uppercase ISO 4217 code.");
  }
  const digits = new Intl.NumberFormat(locale, { style: "currency", currency }).resolvedOptions().maximumFractionDigits;
  if (digits === undefined) throw new RangeError("The selected currency precision is unavailable.");
  return digits;
}

export function parseCurrencyAmountToMinorUnits(amount: string, currency: string, locale = DEFAULT_FORMAT_LOCALE): string {
  const digits = currencyMinorUnitDigits(currency, locale);
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/.exec(amount.trim());
  if (!match || (match[2]?.length ?? 0) > digits) throw new RangeError("Enter a non-negative amount using the selected currency's decimal places.");
  const scale = 10n ** BigInt(digits);
  const whole = BigInt(match[1]!);
  const fraction = BigInt((match[2] ?? "").padEnd(digits, "0") || "0");
  const minorUnits = whole * scale + fraction;
  if (minorUnits.toString().length > 38) throw new RangeError("The amount is too large to record.");
  return minorUnits.toString();
}

export function formatCurrencyMinorUnits(minorUnits: string, currency: string, locale = DEFAULT_FORMAT_LOCALE): string {
  const digits = currencyMinorUnitDigits(currency, locale);
  if (!/^(0|[1-9][0-9]{0,37})$/.test(minorUnits)) throw new RangeError("Currency minor units must be a non-negative integer string.");
  const scale = 10n ** BigInt(digits);
  const value = BigInt(minorUnits);
  const whole = value / scale;
  const fraction = digits ? (value % scale).toString().padStart(digits, "0") : "";
  const formatter = new Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: digits, maximumFractionDigits: digits });
  const localizedDigits = Array.from({ length: 10 }, (_, digit) => new Intl.NumberFormat(locale, { useGrouping: false }).format(digit));
  return formatter.formatToParts(whole).map(part => part.type === "fraction"
    ? [...fraction].map(digit => localizedDigits[Number(digit)]).join("")
    : part.value).join("");
}
