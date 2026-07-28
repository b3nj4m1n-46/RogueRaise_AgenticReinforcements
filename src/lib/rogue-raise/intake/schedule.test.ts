import { describe, expect, it } from "vitest";

import {
  addDays,
  buildFridayKickoff,
  describeSchedule,
  DEFAULT_KICKOFF_HOUR,
  expandSchedule,
  formatWeekendLabel,
  isFridayDate,
  toDateStringInZone,
  weekdayOfDate,
  zonedDateTimeToUtc,
  zonedParts,
} from "./schedule";

// Reference weekends. 2026 US DST: starts Sun Mar 8, ends Sun Nov 1 — the two
// weekends below straddle each transition, which is exactly where naive `+24h`
// arithmetic breaks.
const SUMMER_FRIDAY = "2026-08-14"; // PDT (UTC-7) all weekend
const SPRING_FORWARD_FRIDAY = "2026-03-06"; // PST Fri/Sat → PDT Sun
const FALL_BACK_FRIDAY = "2026-10-30"; // PDT Fri/Sat → PST Sun

describe("weekdayOfDate / isFridayDate", () => {
  it("reads the calendar weekday", () => {
    expect(weekdayOfDate(SUMMER_FRIDAY)).toBe(5);
    expect(weekdayOfDate("2026-08-16")).toBe(0);
  });

  it("accepts Fridays and rejects everything else", () => {
    expect(isFridayDate(SUMMER_FRIDAY)).toBe(true);
    expect(isFridayDate("2026-08-15")).toBe(false);
    expect(isFridayDate("2026-08-13")).toBe(false);
  });

  it("refuses a malformed date rather than guessing", () => {
    expect(() => weekdayOfDate("8/14/2026")).toThrow(/YYYY-MM-DD/);
  });

  it("treats a non-date as 'not a Friday' instead of throwing", () => {
    // isFridayDate is a zod `.refine()` predicate, and zod v4 runs it even when
    // the preceding regex check already failed — a throw here would take out the
    // entire form the moment someone added an empty weekend row.
    expect(isFridayDate("")).toBe(false);
    expect(isFridayDate("8/14/2026")).toBe(false);
    expect(isFridayDate("not a date")).toBe(false);
  });
});

describe("zonedDateTimeToUtc", () => {
  it("anchors a summer (PDT, UTC-7) wall-clock time", () => {
    expect(zonedDateTimeToUtc(SUMMER_FRIDAY, 17).toISOString()).toBe(
      "2026-08-15T00:00:00.000Z",
    );
  });

  it("anchors a winter (PST, UTC-8) wall-clock time", () => {
    expect(zonedDateTimeToUtc(SPRING_FORWARD_FRIDAY, 17).toISOString()).toBe(
      "2026-03-07T01:00:00.000Z",
    );
  });

  it("round-trips back to the same wall clock", () => {
    for (const date of [SUMMER_FRIDAY, SPRING_FORWARD_FRIDAY, FALL_BACK_FRIDAY]) {
      const instant = zonedDateTimeToUtc(date, 17, 30);
      const parts = zonedParts(instant);
      expect(parts.hour).toBe(17);
      expect(parts.minute).toBe(30);
      expect(toDateStringInZone(instant)).toBe(date);
    }
  });

  it("handles midnight without the ICU hour-24 quirk", () => {
    const instant = zonedDateTimeToUtc(SUMMER_FRIDAY, 0);
    expect(zonedParts(instant).hour).toBe(0);
    expect(toDateStringInZone(instant)).toBe(SUMMER_FRIDAY);
  });
});

describe("addDays", () => {
  it("crosses month and year boundaries", () => {
    expect(addDays("2026-10-30", 2)).toBe("2026-11-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29"); // leap year
  });
});

describe("buildFridayKickoff", () => {
  it("defaults to 5:00 PM Pacific", () => {
    const kickoff = buildFridayKickoff(SUMMER_FRIDAY);
    expect(zonedParts(kickoff).hour).toBe(DEFAULT_KICKOFF_HOUR);
    expect(kickoff.toISOString()).toBe("2026-08-15T00:00:00.000Z");
  });

  it("accepts a configured kickoff hour inside the window", () => {
    expect(zonedParts(buildFridayKickoff(SUMMER_FRIDAY, 18, 30)).hour).toBe(18);
  });

  it("refuses a non-Friday", () => {
    expect(() => buildFridayKickoff("2026-08-15")).toThrow(/Friday/);
  });

  it("refuses a kickoff outside the afternoon/evening window", () => {
    expect(() => buildFridayKickoff(SUMMER_FRIDAY, 6)).toThrow(/Kickoff must be/);
    expect(() => buildFridayKickoff(SUMMER_FRIDAY, 23)).toThrow(/Kickoff must be/);
  });
});

describe("expandSchedule", () => {
  it("expands to the canonical Fri/Sat/Sun template", () => {
    const s = expandSchedule(buildFridayKickoff(SUMMER_FRIDAY));
    expect(toDateStringInZone(s.saturdayStartAt)).toBe("2026-08-15");
    expect(zonedParts(s.saturdayStartAt).hour).toBe(9);
    expect(toDateStringInZone(s.sundayPitchesAt)).toBe("2026-08-16");
    expect(zonedParts(s.sundayPitchesAt).hour).toBe(16);
    expect(zonedParts(s.sundayResultsAt).hour).toBe(18);
  });

  it("keeps wall-clock times across the spring-forward transition", () => {
    const s = expandSchedule(buildFridayKickoff(SPRING_FORWARD_FRIDAY));
    // Sunday Mar 8 is PDT (UTC-7): 4:00 PM local == 23:00Z, not 00:00Z.
    expect(s.sundayPitchesAt.toISOString()).toBe("2026-03-08T23:00:00.000Z");
    expect(zonedParts(s.sundayPitchesAt).hour).toBe(16);
    expect(zonedParts(s.sundayResultsAt).hour).toBe(18);
  });

  it("keeps wall-clock times across the fall-back transition", () => {
    const s = expandSchedule(buildFridayKickoff(FALL_BACK_FRIDAY));
    // Sunday Nov 1 is PST (UTC-8): 4:00 PM local == 00:00Z the next day.
    expect(s.sundayPitchesAt.toISOString()).toBe("2026-11-02T00:00:00.000Z");
    expect(zonedParts(s.sundayPitchesAt).hour).toBe(16);
    expect(toDateStringInZone(s.sundayPitchesAt)).toBe("2026-11-01");
  });

  it("always lands Saturday and Sunday on the right weekdays", () => {
    for (const friday of [SUMMER_FRIDAY, SPRING_FORWARD_FRIDAY, FALL_BACK_FRIDAY]) {
      const s = expandSchedule(buildFridayKickoff(friday));
      expect(weekdayOfDate(toDateStringInZone(s.saturdayStartAt))).toBe(6);
      expect(weekdayOfDate(toDateStringInZone(s.sundayResultsAt))).toBe(0);
    }
  });
});

describe("formatting", () => {
  it("labels a same-month weekend compactly", () => {
    expect(formatWeekendLabel(buildFridayKickoff(SUMMER_FRIDAY))).toBe(
      "Aug 14–16, 2026",
    );
  });

  it("spells out both months when a weekend crosses one", () => {
    expect(formatWeekendLabel(buildFridayKickoff(FALL_BACK_FRIDAY))).toBe(
      "Oct 30–Nov 1, 2026",
    );
  });

  it("describes the four fixed moments in order", () => {
    const lines = describeSchedule(buildFridayKickoff(SUMMER_FRIDAY));
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain("Kickoff at 5:00 PM");
    expect(lines[1]).toContain("Full build day from 9:00 AM");
    expect(lines[2]).toContain("Build until 4:00 PM");
    expect(lines[3]).toContain("Results and winners at 6:00 PM");
  });
});
