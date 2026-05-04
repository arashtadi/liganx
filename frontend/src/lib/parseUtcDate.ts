/**
 * parseUtcDate — wrapper around `new Date(...)` that correctly treats
 * bare ISO strings (no timezone marker) as UTC instead of local time.
 *
 * Why this exists:
 *   The Liganx backend serialises `timestamp` columns to ISO strings
 *   like "2026-04-28T18:22:01" — without a trailing "Z" or "+00:00"
 *   offset, because psycopg2 strips the tz marker for non-`timestamptz`
 *   columns. The browser's `new Date(iso)` parser then treats those
 *   strings as LOCAL time per ECMAScript 2019+ — which means the user
 *   sees the UTC clock value displayed as if it were already in their
 *   timezone (i.e. every timestamp is off by their UTC offset).
 *
 *   Fix: detect the missing tz suffix and append "Z" so the parse
 *   goes through UTC, and downstream `toLocaleString()` / arithmetic
 *   converts to the viewer's local zone correctly.
 *
 *   This must be applied EVERYWHERE we render or compute on a backend
 *   timestamp. Search for `new Date(` over backend-sourced fields
 *   (created_at, updated_at, last_sign_in_at, etc.) and route through
 *   this helper.
 *
 * Strings that already carry a timezone marker pass through unchanged,
 * so calling this on a frontend-generated `new Date().toISOString()`
 * (which always ends in Z) is a no-op.
 */
export function parseUtcDate(iso: string): Date {
  // Already-suffixed strings: trust them. Matches "Z" or numeric
  // offsets like "+05:30", "-08:00", "+0530".
  const hasTz = /Z$|[+-]\d{2}:?\d{2}$/.test(iso);
  return new Date(hasTz ? iso : iso + "Z");
}
