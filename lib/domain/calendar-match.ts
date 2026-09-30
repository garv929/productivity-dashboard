import type { CalendarMatchRule } from "@/lib/db/schema";

export type MatchableGroup = {
  id: string;
  slug: string;
  calendarMatch: CalendarMatchRule[];
  sortOrder: number;
  archivedAt?: Date | string | null;
};

const RULE_RANK: Record<CalendarMatchRule["type"], number> = { equals: 0, startsWith: 1, contains: 2 };

/** Case-insensitive, whitespace-collapsed, curly quotes → straight quotes, dashes unified. */
export function normalizeTitle(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[\u2018\u2019\u2032]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function ruleMatches(rule: CalendarMatchRule, title: string): boolean {
  const t = normalizeTitle(title);
  const v = normalizeTitle(rule.value);
  if (!v) return false;
  switch (rule.type) {
    case "equals":
      return t === v;
    case "startsWith":
      return t.startsWith(v);
    case "contains":
      return t.includes(v);
  }
}

/**
 * The group a calendar event belongs to, or null. More specific rules win
 * (equals > startsWith > contains), then the group's sort order.
 */
export function matchEventToGroup<G extends MatchableGroup>(title: string | null | undefined, groups: G[]): G | null {
  if (!title) return null;
  let best: { group: G; rank: number } | null = null;
  for (const group of groups) {
    if (group.archivedAt) continue;
    for (const rule of group.calendarMatch ?? []) {
      if (!ruleMatches(rule, title)) continue;
      const rank = RULE_RANK[rule.type];
      if (!best || rank < best.rank || (rank === best.rank && group.sortOrder < best.group.sortOrder)) {
        best = { group, rank };
      }
    }
  }
  return best?.group ?? null;
}

export function isWeeklyReviewEvent(title: string | null | undefined): boolean {
  return Boolean(title && normalizeTitle(title).includes("weekly review"));
}
