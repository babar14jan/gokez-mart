/**
 * Store opening-hours evaluation, single source of truth.
 *
 * Every store trades in IST, so all reasoning here is anchored to
 * Asia/Kolkata regardless of where the server or the customer's phone
 * happens to be. A naive `new Date().getHours()` would be wrong for any
 * device outside IST -- and for any device at all once the server runs in UTC,
 * which is the normal deployment.
 *
 * This module is deliberately the ONLY place that decides whether a store is
 * open. The storefront renders what this returns and schedules a refetch for
 * `nextOpenAt`, so no schedule math is duplicated in the browser and there is no
 * clock skew between what the customer is told and what the order records.
 *
 * Schedule shape (mart_stores.opening_hours, JSONB):
 *   { "mon": { "open": "09:00", "close": "21:00", "closed": false }, ... }
 * Lowercase three-letter day keys, 24-hour "HH:mm" strings. Missing or
 * malformed entries are ignored rather than treated as open, so a bad edit in
 * the hub degrades to "closed" and never to "open by accident".
 */

/** India Standard Time. Fixed +05:30 with no DST since 1948, but the offset is
 *  still derived from the tz database at runtime rather than hardcoded. */
export const STORE_TIMEZONE = 'Asia/Kolkata';

/** Chronological week order, matching the hub's opening-hours editor. */
export const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type DayKey = typeof DAY_KEYS[number];

const DAY_LABEL: Record<DayKey, string> = {
  mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday',
  fri: 'Friday', sat: 'Saturday', sun: 'Sunday',
};

/** Intl weekday -> our keys. en-US short names are stable and unambiguous. */
const INTL_WEEKDAY: Record<string, DayKey> = {
  Mon: 'mon', Tue: 'tue', Wed: 'wed', Thu: 'thu', Fri: 'fri', Sat: 'sat', Sun: 'sun',
};

export interface DayHours { open?: string; close?: string; closed?: boolean }
export type OpeningHours = Record<string, DayHours | null | undefined> | null | undefined;

/**
 * Why the store is closed. Kept distinct because the customer-facing copy and
 * the order record both need to tell the two apart: a manual closure has no
 * meaningful "next opening" to promise, whereas being outside scheduled hours
 * usually does.
 */
export type ClosedReason = 'manual' | 'outside_hours' | 'never_opens';

export interface StoreOpenState {
  isOpen: boolean;
  closedReason: ClosedReason | null;
  /** UTC ISO instant the store next opens, or null if it never does. */
  nextOpenAt: string | null;
  /** Preformatted IST label, e.g. "9:00 AM tomorrow". Null when never_opens. */
  nextOpenLabel: string | null;
  /** Preformatted IST label for the current closing time, when open. */
  closesAtLabel: string | null;
}

// ── IST primitives ────────────────────────────────────────────────────────────

const partsFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: STORE_TIMEZONE, hour12: false,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short',
});

interface IstParts { y: number; mo: number; d: number; h: number; mi: number; day: DayKey }

/** Wall-clock parts of `instant` as observed in IST. */
function istParts(instant: Date): IstParts {
  const p: Record<string, string> = {};
  for (const part of partsFmt.formatToParts(instant)) p[part.type] = part.value;
  return {
    y: Number(p.year),
    // Intl renders midnight as hour "24" in some ICU builds; normalise to 0.
    h: Number(p.hour) % 24,
    mo: Number(p.month),
    d: Number(p.day),
    mi: Number(p.minute),
    day: INTL_WEEKDAY[p.weekday] ?? 'mon',
  };
}

/**
 * Minutes east of UTC for IST at `instant`, derived from the tz database by
 * formatting the instant and reading it back as if it were UTC. Avoids
 * hardcoding +05:30 while staying correct if the zone definition ever changes.
 */
function istOffsetMinutes(instant: Date): number {
  const p = istParts(instant);
  const asIfUtc = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi);
  return Math.round((asIfUtc - instant.getTime()) / 60000);
}

/**
 * Build the UTC instant for an IST wall-clock time. `dayOffset` walks whole days
 * from `reference`'s IST calendar day, so adding one gives "the same time
 * tomorrow" across month and year boundaries.
 */
function istInstant(reference: Date, dayOffset: number, minutesOfDay: number): Date {
  const p = istParts(reference);
  const base = Date.UTC(p.y, p.mo - 1, p.d + dayOffset, 0, 0, 0, 0);
  // Offset sampled at midday of the target day, so a DST boundary inside the
  // shift cannot skew the result by an hour.
  const sample = new Date(base + 12 * 3600_000);
  return new Date(base + minutesOfDay * 60_000 - istOffsetMinutes(sample) * 60_000);
}

/** Parse "HH:mm" to minutes past midnight IST. Returns null if unusable. */
function parseHhMm(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]); const min = Number(m[2]);
  if (!Number.isInteger(h) || !Number.isInteger(min)) return null;
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

/** A day is usable only when it is not flagged closed and both times parse. */
function dayWindow(hours: OpeningHours, day: DayKey): { open: number; close: number } | null {
  const raw = hours?.[day];
  if (!raw || typeof raw !== 'object') return null;
  if (raw.closed === true) return null;
  const open = parseHhMm(raw.open);
  const close = parseHhMm(raw.close);
  if (open === null || close === null) return null;
  return { open, close };
}

/**
 * "21:30" -> "9:30 PM", in IST.
 *
 * Formatted by hand rather than via Intl's time formatter. `en-IN` currently
 * renders this as "09:30 pm" -- a leading zero and a lowercase meridiem, neither
 * of which matches the copy used elsewhere in the storefront. It is also not
 * guaranteed: the pattern comes from the ICU data bundled with the runtime, so a
 * small-icu build or a locale-data change would silently alter customer-facing
 * text. The arithmetic here is fixed, so the wording cannot drift.
 */
function formatIstTime(minutesOfDay: number): string {
  const total = ((minutesOfDay % 1440) + 1440) % 1440;
  const h24 = Math.floor(total / 60);
  const min = total % 60;
  const meridiem = h24 < 12 ? 'AM' : 'PM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(min).padStart(2, '0')} ${meridiem}`;
}

const DAY_NAMES: Record<DayKey, string> = { ...DAY_LABEL };

/** "9:00 AM tomorrow" / "9:00 AM on Friday" / "9:00 AM today". */
function describeNextOpen(dayOffset: number, minutesOfDay: number, target: DayKey): string {
  const time = formatIstTime(minutesOfDay);
  if (dayOffset === 0) return `${time} today`;
  if (dayOffset === 1) return `${time} tomorrow`;
  return `${time} on ${DAY_NAMES[target]}`;
}

// ── The evaluation ────────────────────────────────────────────────────────────

/**
 * Decide whether a store is open, and when it next opens.
 *
 * @param openingHours mart_stores.opening_hours
 * @param storeOpen    mart_settings.store_open, the manual override. Anything
 *                     other than the string 'true' (or boolean true) is closed,
 *                     matching how the hub's BOOLEAN_KEYS toggle stores it.
 * @param now          injectable for tests
 */
export function evaluateStoreOpen(
  openingHours: OpeningHours,
  storeOpen: string | boolean | null | undefined,
  now: Date = new Date(),
): StoreOpenState {
  // Manual override wins. A closed store is not "outside hours", and promising a
  // next opening would be a lie: the owner closed it deliberately.
  const manualOpen = storeOpen === true || storeOpen === 'true';
  if (!manualOpen) {
    return { isOpen: false, closedReason: 'manual', nextOpenAt: null, nextOpenLabel: null, closesAtLabel: null };
  }

  const p = istParts(now);
  const todayIdx = DAY_KEYS.indexOf(p.day);
  const nowMinutes = p.h * 60 + p.mi;

  // If every day is unusable the store simply never opens. Surfaced explicitly
  // so the storefront can say "closed" rather than inventing an opening time.
  if (DAY_KEYS.every(d => dayWindow(openingHours, d) === null)) {
    return { isOpen: false, closedReason: 'never_opens', nextOpenAt: null, nextOpenLabel: null, closesAtLabel: null };
  }

  // A window whose close is at or before its open is read as running past
  // midnight into the next day, e.g. 22:00-02:00. The hub's time inputs make
  // this reachable, so it has to be handled rather than treated as empty.
  const isOvernight = (w: { open: number; close: number }) => w.close <= w.open;

  const contains = (w: { open: number; close: number }, m: number) =>
    isOvernight(w) ? (m >= w.open || m < w.close) : (m >= w.open && m < w.close);

  // Today: either today's own window, or yesterday's overnight window spilling
  // over into this morning.
  const today = dayWindow(openingHours, p.day);
  if (today && contains(today, nowMinutes)) {
    const closesIn = isOvernight(today) ? today.close + 24 * 60 : today.close;
    return {
      isOpen: true, closedReason: null, nextOpenAt: null, nextOpenLabel: null,
      closesAtLabel: closesIn >= 24 * 60
        ? formatIstTime(closesIn - 24 * 60)
        : formatIstTime(closesIn),
    };
  }

  const yesterday = dayWindow(openingHours, DAY_KEYS[(todayIdx + 6) % 7]!);
  if (yesterday && isOvernight(yesterday) && nowMinutes < yesterday.close) {
    return {
      isOpen: true, closedReason: null, nextOpenAt: null, nextOpenLabel: null,
      closesAtLabel: formatIstTime(yesterday.close),
    };
  }

  // Closed: find the next opening within the coming week.
  for (let offset = 0; offset <= 7; offset++) {
    const day = DAY_KEYS[(todayIdx + offset) % 7]!;
    const w = dayWindow(openingHours, day);
    if (!w) continue;
    // Today's opening has already passed; later days have not.
    if (offset === 0 && w.open <= nowMinutes) continue;
    const at = istInstant(now, offset, w.open);
    return {
      isOpen: false,
      closedReason: 'outside_hours',
      nextOpenAt: at.toISOString(),
      nextOpenLabel: describeNextOpen(offset, w.open, day),
      closesAtLabel: null,
    };
  }

  return { isOpen: false, closedReason: 'never_opens', nextOpenAt: null, nextOpenLabel: null, closesAtLabel: null };
}

/**
 * Format any instant as an IST wall-clock string, e.g. "8 Jan, 9:00 AM".
 *
 * Exists so callers do not reach for `toLocaleString('en-IN', ...)`. That call
 * looks right but silently renders in the runtime's own timezone, which is how
 * order times end up displayed in whatever zone the server happens to run in.
 * The meridiem is built here for the same reason as formatIstTime: ICU locale
 * data is not guaranteed to be present or stable across runtime builds.
 */
export function formatIstDateTime(value: string | Date | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  const instant = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(instant.getTime())) return null;

  const parts: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat('en-US', {
    timeZone: STORE_TIMEZONE, year: 'numeric', month: 'short', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(instant)) parts[part.type] = part.value;

  const h24 = Number(parts.hour) % 24;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const meridiem = h24 < 12 ? 'AM' : 'PM';
  return `${Number(parts.day)} ${parts.month}, ${h12}:${parts.minute} ${meridiem}`;
}
