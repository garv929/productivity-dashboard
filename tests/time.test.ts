import { describe, expect, it } from "vitest";
import { addDays, dayRange, isoWeekday, localDate, mondayOf, weekRange, weekRangeFromStart } from "@/lib/domain/time";

const LA = "America/Los_Angeles";
const HOUR = 3_600_000;

describe("week boundaries (Monday–Sunday, app timezone)", () => {
  it("finds the Monday for any day, including Sunday", () => {
    expect(mondayOf("2026-10-07")).toBe("2026-10-05"); // Wed
    expect(mondayOf("2026-10-11")).toBe("2026-10-05"); // Sun
    expect(mondayOf("2026-10-12")).toBe("2026-10-12"); // Mon
    expect(isoWeekday("2026-10-11")).toBe(7);
  });

  it("uses local time, not UTC, to decide the week", () => {
    // Sunday 11pm in LA is already Monday in UTC.
    const sundayNight = new Date("2026-10-12T06:00:00Z");
    expect(localDate(sundayNight, LA)).toBe("2026-10-11");
    expect(weekRange(sundayNight, LA).weekStart).toBe("2026-10-05");
    // Monday 00:30 in LA.
    expect(weekRange(new Date("2026-10-12T07:30:00Z"), LA).weekStart).toBe("2026-10-12");
  });

  it("starts weeks at local midnight", () => {
    const w = weekRangeFromStart("2026-10-05", LA);
    expect(w.start.toISOString()).toBe("2026-10-05T07:00:00.000Z"); // PDT, UTC-7
    expect(w.end.toISOString()).toBe("2026-10-12T07:00:00.000Z");
    expect(w.days).toEqual(["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11"]);
    expect(w.weekEnd).toBe("2026-10-11");
  });

  it("handles the March 2026 spring-forward week (167 hours)", () => {
    // DST starts Sun Mar 8, 2026 at 2am in LA.
    const w = weekRangeFromStart("2026-03-02", LA);
    expect(w.start.toISOString()).toBe("2026-03-02T08:00:00.000Z"); // PST, UTC-8
    expect(w.end.toISOString()).toBe("2026-03-09T07:00:00.000Z"); // PDT, UTC-7
    expect((w.end.getTime() - w.start.getTime()) / HOUR).toBe(167);
    const sunday = dayRange("2026-03-08", LA);
    expect((sunday.end.getTime() - sunday.start.getTime()) / HOUR).toBe(23);
  });

  it("handles the November 2026 fall-back week (169 hours)", () => {
    // DST ends Sun Nov 1, 2026 at 2am in LA; the week containing it is Oct 26 – Nov 1.
    const w = weekRangeFromStart("2026-10-26", LA);
    expect(w.start.toISOString()).toBe("2026-10-26T07:00:00.000Z");
    expect(w.end.toISOString()).toBe("2026-11-02T08:00:00.000Z");
    expect((w.end.getTime() - w.start.getTime()) / HOUR).toBe(169);
    const sunday = dayRange("2026-11-01", LA);
    expect((sunday.end.getTime() - sunday.start.getTime()) / HOUR).toBe(25);
  });

  it("assigns instants around the fall-back hour to the right local day and week", () => {
    // 1:30am happens twice on Nov 1; both are still Sunday in the Oct 26 week.
    const firstPass = new Date("2026-11-01T08:30:00Z"); // 1:30 PDT
    const secondPass = new Date("2026-11-01T09:30:00Z"); // 1:30 PST
    for (const t of [firstPass, secondPass]) {
      expect(localDate(t, LA)).toBe("2026-11-01");
      expect(weekRange(t, LA).weekStart).toBe("2026-10-26");
    }
    // Sunday 11:59pm PST is still that week; a minute later is the next one.
    expect(weekRange(new Date("2026-11-02T07:59:00Z"), LA).weekStart).toBe("2026-10-26");
    expect(weekRange(new Date("2026-11-02T08:00:00Z"), LA).weekStart).toBe("2026-11-02");
  });

  it("does pure calendar arithmetic across month and DST edges", () => {
    expect(addDays("2026-03-07", 2)).toBe("2026-03-09");
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});
