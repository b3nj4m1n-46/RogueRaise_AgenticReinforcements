/**
 * Fixed schedule template (PRD §5.2.3) — the single source of truth for what a
 * Rogue Raise weekend looks like. Every downstream artifact (deck, emails,
 * landing page, judge invites) formats FROM this module so times never drift.
 *
 *   Friday   — Kickoff (default 5:00 PM, configurable per option)
 *   Saturday — Full build day (from 9:00 AM)
 *   Sunday   — Build until 4:00 PM → pitches; 6:00 PM → results + winners
 *
 * Every option is anchored on its FRIDAY. Only the Friday kickoff instant is
 * stored (`date_options.friday_kickoff_at`); the rest of the weekend is derived
 * here, so a template change is a one-line change.
 *
 * Timezone: all instants are anchored in `America/Los_Angeles` (Ashland, OR) and
 * stored as `timestamptz`. Offset resolution uses `Intl.DateTimeFormat` rather
 * than a date library — DST-correct with zero dependencies.
 */

/** Where a Rogue Raise physically happens; all wall-clock times are this zone. */
export const EVENT_TIMEZONE = "America/Los_Angeles";

/** Friday kickoff default — 5:00 PM. Configurable per date option. */
export const DEFAULT_KICKOFF_HOUR = 17;
export const DEFAULT_KICKOFF_MINUTE = 0;

/** Saturday is a full build day; the room opens at 9:00 AM. */
export const SATURDAY_START_HOUR = 9;

/** Sunday: build stops at 4:00 PM for pitches, results announced at 6:00 PM. */
export const SUNDAY_PITCHES_HOUR = 16;
export const SUNDAY_RESULTS_HOUR = 18;

/** Kickoff may be moved within the Friday afternoon/evening, never outside it. */
export const MIN_KICKOFF_HOUR = 12;
export const MAX_KICKOFF_HOUR = 20;

/** `YYYY-MM-DD` — a calendar date, deliberately not an instant. */
export const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/** The four fixed moments a single date option expands to. */
export interface WeekendSchedule {
  fridayKickoffAt: Date;
  saturdayStartAt: Date;
  sundayPitchesAt: Date;
  sundayResultsAt: Date;
}

// ---------------------------------------------------------------------------
// Timezone primitives
// ---------------------------------------------------------------------------

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** Wall-clock parts of `instant` as read in `timeZone`. */
export function zonedParts(
  instant: Date,
  timeZone: string = EVENT_TIMEZONE,
): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);

  const get = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((p) => p.type === type);
    return part ? Number(part.value) : 0;
  };

  // `hour12: false` renders midnight as "24" in some ICU versions — normalize.
  const hour = get("hour") % 24;
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour,
    minute: get("minute"),
    second: get("second"),
  };
}

/** Offset of `timeZone` from UTC at `instant`, in ms (negative west of UTC). */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asIfUtc - instant.getTime();
}

/**
 * Convert a wall-clock date + time IN `timeZone` to the corresponding UTC
 * instant. Two-pass so a DST transition between the guess and the true instant
 * still resolves correctly.
 */
export function zonedDateTimeToUtc(
  dateStr: string,
  hour: number,
  minute: number = 0,
  timeZone: string = EVENT_TIMEZONE,
): Date {
  if (!DATE_ONLY_REGEX.test(dateStr)) {
    throw new Error(`Expected a YYYY-MM-DD date, got "${dateStr}"`);
  }
  const [year, month, day] = dateStr.split("-").map(Number);
  const naive = Date.UTC(year, month - 1, day, hour, minute, 0);

  let ts = naive - zoneOffsetMs(new Date(naive), timeZone);
  ts = naive - zoneOffsetMs(new Date(ts), timeZone);
  return new Date(ts);
}

/** Calendar-date weekday (0=Sun … 5=Fri). Zone-independent by construction. */
export function weekdayOfDate(dateStr: string): number {
  if (!DATE_ONLY_REGEX.test(dateStr)) {
    throw new Error(`Expected a YYYY-MM-DD date, got "${dateStr}"`);
  }
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/**
 * True when the calendar date falls on a Friday — the anchor every option needs.
 *
 * TOTAL by design: anything that isn't a date simply isn't a Friday. It is used
 * as a zod `.refine()` predicate, and zod v4 runs every check on a field even
 * after an earlier one fails — so a throwing predicate would blow up the whole
 * form the moment someone opened an empty date row.
 */
export function isFridayDate(dateStr: string): boolean {
  if (!DATE_ONLY_REGEX.test(dateStr)) return false;
  return weekdayOfDate(dateStr) === 5;
}

/** `YYYY-MM-DD` of `instant` as read in `timeZone`. */
export function toDateStringInZone(
  instant: Date,
  timeZone: string = EVENT_TIMEZONE,
): string {
  const p = zonedParts(instant, timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Add whole calendar days to a `YYYY-MM-DD` string (no zone involved). */
export function addDays(dateStr: string, days: number): string {
  if (!DATE_ONLY_REGEX.test(dateStr)) {
    throw new Error(`Expected a YYYY-MM-DD date, got "${dateStr}"`);
  }
  const [year, month, day] = dateStr.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(
    shifted.getUTCDate(),
  )}`;
}

// ---------------------------------------------------------------------------
// The template
// ---------------------------------------------------------------------------

/**
 * Build the stored Friday-kickoff instant for a chosen weekend. Throws if the
 * date isn't a Friday or the hour is outside the allowed kickoff window —
 * callers validate with zod first so users see a friendly message instead.
 */
export function buildFridayKickoff(
  dateStr: string,
  hour: number = DEFAULT_KICKOFF_HOUR,
  minute: number = DEFAULT_KICKOFF_MINUTE,
): Date {
  if (!isFridayDate(dateStr)) {
    throw new Error(`Rogue Raise weekends start on a Friday; "${dateStr}" is not.`);
  }
  if (hour < MIN_KICKOFF_HOUR || hour > MAX_KICKOFF_HOUR) {
    throw new Error(
      `Kickoff must be between ${MIN_KICKOFF_HOUR}:00 and ${MAX_KICKOFF_HOUR}:00.`,
    );
  }
  return zonedDateTimeToUtc(dateStr, hour, minute);
}

/**
 * Expand a stored Friday kickoff into the canonical weekend. Saturday/Sunday
 * times are re-anchored to their own calendar dates (never `+24h` arithmetic),
 * so a DST weekend keeps its wall-clock schedule.
 */
export function expandSchedule(fridayKickoffAt: Date): WeekendSchedule {
  const friday = toDateStringInZone(fridayKickoffAt);
  const saturday = addDays(friday, 1);
  const sunday = addDays(friday, 2);

  return {
    fridayKickoffAt,
    saturdayStartAt: zonedDateTimeToUtc(saturday, SATURDAY_START_HOUR),
    sundayPitchesAt: zonedDateTimeToUtc(sunday, SUNDAY_PITCHES_HOUR),
    sundayResultsAt: zonedDateTimeToUtc(sunday, SUNDAY_RESULTS_HOUR),
  };
}

// ---------------------------------------------------------------------------
// Formatting (shared by UI + generated assets so wording never diverges)
// ---------------------------------------------------------------------------

/** e.g. `Fri, Aug 14` */
export function formatDayInZone(instant: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: EVENT_TIMEZONE,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(instant);
}

/** e.g. `5:00 PM` */
export function formatTimeInZone(instant: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: EVENT_TIMEZONE,
    hour: "numeric",
    minute: "2-digit",
  }).format(instant);
}

/** e.g. `Aug 14–16, 2026` — the label a POC recognizes a weekend by. */
export function formatWeekendLabel(fridayKickoffAt: Date): string {
  const { sundayResultsAt } = expandSchedule(fridayKickoffAt);
  const monthDay = new Intl.DateTimeFormat("en-US", {
    timeZone: EVENT_TIMEZONE,
    month: "short",
    day: "numeric",
  });
  const fridayLabel = monthDay.format(fridayKickoffAt);
  const sundayParts = zonedParts(sundayResultsAt);
  const fridayParts = zonedParts(fridayKickoffAt);
  const sundayLabel =
    sundayParts.month === fridayParts.month
      ? String(sundayParts.day)
      : monthDay.format(sundayResultsAt);
  return `${fridayLabel}–${sundayLabel}, ${sundayParts.year}`;
}

/** Human-readable timeline lines — the same copy the POC and the deck see. */
export function describeSchedule(fridayKickoffAt: Date): string[] {
  const s = expandSchedule(fridayKickoffAt);
  return [
    `${formatDayInZone(s.fridayKickoffAt)} — Kickoff at ${formatTimeInZone(s.fridayKickoffAt)}`,
    `${formatDayInZone(s.saturdayStartAt)} — Full build day from ${formatTimeInZone(s.saturdayStartAt)}`,
    `${formatDayInZone(s.sundayPitchesAt)} — Build until ${formatTimeInZone(s.sundayPitchesAt)}, then pitches`,
    `${formatDayInZone(s.sundayResultsAt)} — Results and winners at ${formatTimeInZone(s.sundayResultsAt)}`,
  ];
}
