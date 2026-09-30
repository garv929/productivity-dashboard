import { describe, expect, it } from "vitest";
import { isWeeklyReviewEvent, matchEventToGroup, normalizeTitle, ruleMatches, type MatchableGroup } from "@/lib/domain/calendar-match";

const g = (slug: string, sortOrder: number, calendarMatch: MatchableGroup["calendarMatch"], archivedAt: Date | null = null): MatchableGroup => ({
  id: slug,
  slug,
  sortOrder,
  calendarMatch,
  archivedAt,
});

const groups = [
  g("positioning", 0, [{ type: "startsWith", value: "Phase 1:" }]),
  g("applications", 1, [{ type: "equals", value: "Recruiting: Applications" }]),
  g("networking", 2, [
    { type: "equals", value: "Recruiting: Networking & outreach" },
    { type: "equals", value: "Follow-ups & inbox" },
  ]),
  g("side-income", 5, [{ type: "equals", value: "What's something you want to do to make some cash?" }]),
  g("catch-all", 9, [{ type: "contains", value: "recruiting" }]),
];

describe("calendar → group matcher", () => {
  it("matches exact titles case-insensitively with extra whitespace", () => {
    expect(matchEventToGroup("  recruiting:   applications ", groups)?.slug).toBe("applications");
  });

  it("matches startsWith rules", () => {
    expect(matchEventToGroup("Phase 1: rewrite LinkedIn headline", groups)?.slug).toBe("positioning");
    expect(matchEventToGroup("Prep for Phase 1: later", groups)).toBeNull();
  });

  it("normalises curly quotes and dashes", () => {
    expect(matchEventToGroup("What’s something you want to do to make some cash?", groups)?.slug).toBe("side-income");
    expect(normalizeTitle("Phase 1 – Positioning")).toBe("phase 1 - positioning");
  });

  it("supports several rules per group", () => {
    expect(matchEventToGroup("Follow-ups & inbox", groups)?.slug).toBe("networking");
  });

  it("prefers the more specific rule over an earlier-sorted contains rule", () => {
    const withEarlyContains = [g("broad", -1, [{ type: "contains", value: "recruiting" }]), ...groups];
    expect(matchEventToGroup("Recruiting: Applications", withEarlyContains)?.slug).toBe("applications");
  });

  it("falls back to contains rules and breaks ties by sort order", () => {
    expect(matchEventToGroup("Recruiting: coffee chat", groups)?.slug).toBe("catch-all");
    const tie = [g("b", 2, [{ type: "contains", value: "prep" }]), g("a", 1, [{ type: "contains", value: "prep" }])];
    expect(matchEventToGroup("interview prep", tie)?.slug).toBe("a");
  });

  it("returns null for unmatched, empty titles and archived groups", () => {
    expect(matchEventToGroup("Dentist", groups)).toBeNull();
    expect(matchEventToGroup("", groups)).toBeNull();
    expect(matchEventToGroup(null, groups)).toBeNull();
    const archived = [g("old", 0, [{ type: "equals", value: "Dentist" }], new Date())];
    expect(matchEventToGroup("Dentist", archived)).toBeNull();
  });

  it("ignores empty rule values", () => {
    expect(ruleMatches({ type: "contains", value: "  " }, "anything")).toBe(false);
  });

  it("recognises weekly review events", () => {
    expect(isWeeklyReviewEvent("Sunday – Weekly Review")).toBe(true);
    expect(isWeeklyReviewEvent("Weekly planning")).toBe(false);
  });
});
