# Date, time and currency formatting

## Current launch behavior

The first service centre is in Ghana. The web app uses `en-GH` for dates, times, and number grouping, and `Africa/Accra` for displayed timestamps. The date/time formatter accepts an explicit IANA timezone so another site can render the same UTC instant in its own local zone. Invalid timestamps show `Time unavailable`; an invalid configured timezone fails visibly instead of silently falling back to the user's device timezone.

Sites persist a `time_zone` field with `Africa/Accra` as the default, and the authenticated site projection returns it as `timeZone`. This makes the canonical site setting available to clients without trusting a browser-supplied timezone. Staff workflow, request, message, controlled-document, evidence, overview and print timestamps now pass the selected site's timezone to the shared formatter. The site setting still defaults to Ghana and has no approved user-facing configuration path; do not add a site in another timezone until that path is reviewed.

All message, read-receipt, overview refresh, work-order, intake and print timestamps must use the shared `formatDateTime`/`dateTime` formatter. Do not call `Date.toLocaleString` without an explicit zone for a business timestamp. For callback and observed-work entry, interpret `datetime-local` input in the site's timezone and convert it to a UTC instant; reject ambiguous or nonexistent daylight-saving times. When correcting an entry with an unchanged local time, preserve its original instant even if the wall-clock time occurs twice. Server records remain UTC instants (`timestamptz`); formatting never changes the stored instant.

## Currency

`formatCurrency` requires a finite amount and an explicit uppercase ISO 4217 currency code. Validation uses the bundled currency identifiers from Unicode CLDR 49 (`apps/web/src/currency-codes.ts`), not the browser's `Intl.supportedValuesOf` list. This avoids both a module-load crash on older browser engines and runtime-dependent rejection when browser ICU data is older or incomplete. `Intl.NumberFormat` is used only for locale-specific symbol, grouping, and fractional precision. GHS therefore renders using Ghana cedi conventions; other listed codes use the runtime's formatting data. Keep the list pinned to a stable CLDR release and compare it to `common/bcp47/currency.xml` when refreshing. There is intentionally no implicit GHS fallback when the currency is missing or malformed.

This utility is presentation only. It does not define amounts, tax, exchange rates, rounding of ledger values, payer terms, invoice policy, or whether a currency is permitted for a business transaction. Monetary records remain integer minor units with an explicit currency and precision policy as specified by the system design. Historical monetary rows remain quarantined until REV-037 is resolved.

## Configuration boundary and open work

The initial service centre uses `Africa/Accra`. There is no user-facing timezone editor or arbitrary timezone configuration authority yet. Before adding a site in another timezone, approve a site-configuration path and validate its IANA timezone. Business timestamps use the authenticated site's current value; browser/device locale and timezone must not override it.

Financial screens must call `formatCurrency` with the currency stored on the canonical value. A transaction must not infer currency from the viewer locale. `REV-007` controls financial terms and `REV-037` controls imported currency/precision metadata. Neither decision is replaced by a formatting helper.

## Verification

`apps/web/src/formatting.test.ts` covers Accra date rollover, a second IANA timezone, daylight-saving gaps and repeats, invalid timestamps/timezones, GHS/USD/EUR/JPY output, a CLDR code newer than some runtime datasets, operation when `Intl.supportedValuesOf` is absent, and malformed amounts/codes. The `current_staff_session_sites` projection and authenticated API tests verify that the persisted site timezone is returned to signed-in staff. Site-timezone inputs and work-entry history were checked in a browser with a Los Angeles device and Accra site. All business JSX timestamp calls have now been wired to the authenticated site timezone; focused browser verification is still needed for message, callback, overview and print displays under a non-default site timezone. A static formatter test does not prove screen-reader announcements or use of a non-default site timezone.
