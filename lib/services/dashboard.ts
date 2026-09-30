import "server-only";
import { and, eq, gte, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { activityLog, applications, contacts, type Group } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { getCalendarEvents, tagEvents, type CalendarStatus, type TaggedEvent } from "@/lib/calendar";
import { listCompletedTasks, listOpenTasks } from "@/lib/todoist";
import type { TaskLite } from "@/lib/todoist/types";
import { groupForTask, tasksByGroup } from "@/lib/domain/group-mapping";
import { isWeeklyReviewEvent } from "@/lib/domain/calendar-match";
import { countTasks, pickNextStep, rankNextSteps, sortTaskTree, type TaskCounts, type TaskNode } from "@/lib/domain/next-step";
import { addDays, dayRange, describeBlock, formatLocal, localDate, weekRange, weekRangeFromStart } from "@/lib/domain/time";
import { computeWarnings, type Warning } from "@/lib/domain/warnings";
import { computeScorecard, type ScoreRow } from "@/lib/domain/scorecard";
import { listActiveGroups, requireActiveGroup, getGroupBySlug } from "@/lib/domain/groups";
import { listActivity } from "./activity";
import { getTargets, getWeeklyReview, listWeeklyReviews } from "./targets";

export type GroupSummary = Pick<Group, "id" | "slug" | "name" | "kind" | "color" | "icon" | "sortOrder">;

export type GroupCard = GroupSummary & {
  nextStep: TaskLite | null;
  counts: TaskCounts;
  nextBlock: { label: string; start: string; end: string; title: string } | null;
  mapped: boolean;
};

export type NowBlock = {
  event: TaggedEvent;
  minutesRemaining: number;
  untilLabel: string;
  isWeeklyReview: boolean;
} | null;

export type Overview = {
  generatedAt: string;
  tz: string;
  today: string;
  cards: GroupCard[];
  now: NowBlock;
  todayEvents: (TaggedEvent & { isWeeklyReview: boolean })[];
  warnings: Warning[];
  calendarStatus: CalendarStatus;
};

function summary(g: Group): GroupSummary {
  return { id: g.id, slug: g.slug, name: g.name, kind: g.kind, color: g.color, icon: g.icon, sortOrder: g.sortOrder };
}

function overlapMinutes(ev: { start: string; end: string }, from: Date, to: Date): number {
  const s = Math.max(new Date(ev.start).getTime(), from.getTime());
  const e = Math.min(new Date(ev.end).getTime(), to.getTime());
  return Math.max(0, Math.round((e - s) / 60_000));
}

export function findNowBlock(events: TaggedEvent[], now: Date, tz: string): NowBlock {
  const t = now.getTime();
  const current = events
    .filter((e) => !e.allDay && new Date(e.start).getTime() <= t && new Date(e.end).getTime() > t)
    .sort((a, b) => Number(Boolean(b.groupId)) - Number(Boolean(a.groupId)))[0];
  if (!current) return null;
  const end = new Date(current.end);
  return {
    event: current,
    minutesRemaining: Math.round((end.getTime() - t) / 60_000),
    untilLabel: formatLocal(end, tz, "h:mm").replace(":00", ""),
    isWeeklyReview: isWeeklyReviewEvent(current.title),
  };
}

export async function getOverview(userId: string, now = new Date()): Promise<Overview> {
  const tz = env.APP_TIMEZONE;
  const today = localDate(now, tz);
  const todayRange = dayRange(today, tz);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000);

  const groups = await listActiveGroups(userId);
  const [openTasks, calendar, completed7, activity7, contactRows, appRows] = await Promise.all([
    listOpenTasks(),
    getCalendarEvents(userId, todayRange.start, dayRange(addDays(today, 8), tz).start),
    listCompletedTasks(new Date(Math.floor(sevenDaysAgo.getTime() / 3_600_000) * 3_600_000).toISOString(), todayRange.end.toISOString()),
    db.select().from(activityLog).where(and(eq(activityLog.userId, userId), gte(activityLog.occurredAt, sevenDaysAgo))),
    db.select().from(contacts).where(eq(contacts.userId, userId)),
    db.select().from(applications).where(and(eq(applications.userId, userId), eq(applications.stage, "applied"))),
  ]);

  const ctx = { today, now };
  const byGroup = tasksByGroup(openTasks, groups);
  const events = tagEvents(calendar.events, groups);

  const cards: GroupCard[] = groups.map((g) => {
    const tasks = byGroup.get(g.id) ?? [];
    const next = events.find((e) => e.groupId === g.id && new Date(e.end).getTime() > now.getTime());
    return {
      ...summary(g),
      nextStep: pickNextStep(tasks, ctx),
      counts: countTasks(tasks, ctx),
      nextBlock: next ? { label: describeBlock(next.start, next.end, now, tz), start: next.start, end: next.end, title: next.title } : null,
      mapped: Boolean(g.todoistProjectId),
    };
  });

  const completedByGroup = new Map<string, number>();
  for (const t of completed7) {
    const g = groupForTask(t, groups);
    if (g) completedByGroup.set(g.id, (completedByGroup.get(g.id) ?? 0) + 1);
  }
  const activityByGroup = new Map<string, number>();
  for (const a of activity7) if (a.groupId) activityByGroup.set(a.groupId, (activityByGroup.get(a.groupId) ?? 0) + 1);

  const calendarMinutesToday = new Map<string, number>();
  for (const e of events) {
    if (!e.groupId || e.allDay) continue;
    calendarMinutesToday.set(e.groupId, (calendarMinutesToday.get(e.groupId) ?? 0) + overlapMinutes(e, todayRange.start, todayRange.end));
  }

  const followUps = appRows.length
    ? await db
        .select({ refId: activityLog.refId, occurredAt: activityLog.occurredAt })
        .from(activityLog)
        .where(
          and(
            eq(activityLog.userId, userId),
            eq(activityLog.type, "follow_up"),
            eq(activityLog.refType, "application"),
            inArray(activityLog.refId, appRows.map((a) => a.id)),
          ),
        )
    : [];
  const withFollowUp = new Set(
    followUps
      .filter((f) => {
        const app = appRows.find((a) => a.id === f.refId);
        return app?.appliedAt && f.occurredAt >= app.appliedAt;
      })
      .map((f) => f.refId!),
  );

  const warnings = computeWarnings({
    ctx,
    groups: groups.map((g) => ({ id: g.id, slug: g.slug, name: g.name, createdAt: g.createdAt })),
    openTasksByGroup: byGroup,
    completedLast7ByGroup: completedByGroup,
    activityLast7ByGroup: activityByGroup,
    contacts: contactRows,
    applications: appRows,
    applicationsWithFollowUp: withFollowUp,
    calendarMinutesTodayByGroup: calendarMinutesToday,
    networkingSlug: groups.find((g) => g.kind === "people")?.slug,
    applicationsSlug: groups.find((g) => g.kind === "pipeline")?.slug,
  });

  const todayEvents = events
    .filter((e) => localDate(new Date(e.start), tz) === today || (e.allDay && e.start <= todayRange.start.toISOString() && e.end > todayRange.start.toISOString()))
    .map((e) => ({ ...e, isWeeklyReview: isWeeklyReviewEvent(e.title) }));

  return {
    generatedAt: now.toISOString(),
    tz,
    today,
    cards,
    now: findNowBlock(events, now, tz),
    todayEvents,
    warnings,
    calendarStatus: calendar.status,
  };
}

export type GroupPageData = {
  group: GroupSummary & { archived: boolean; mapped: boolean; todoistProjectId: string | null; todoistSectionId: string | null };
  nextStep: TaskLite | null;
  alternatives: TaskLite[];
  tree: TaskNode[];
  counts: TaskCounts;
  doneThisWeek: TaskLite[];
  weekStart: string;
  today: string;
  otherGroups: GroupSummary[];
};

export async function getGroupPageData(userId: string, slug: string, now = new Date()): Promise<GroupPageData | null> {
  const tz = env.APP_TIMEZONE;
  const group = await getGroupBySlug(userId, slug);
  if (!group) return null;
  const today = localDate(now, tz);
  const week = weekRange(now, tz);
  const [allGroups, openTasks, completed] = await Promise.all([
    listActiveGroups(userId),
    listOpenTasks(),
    listCompletedTasks(week.start.toISOString(), week.end.toISOString()),
  ]);
  const scope = group.archivedAt ? [{ ...group, archivedAt: null }] : allGroups;
  const mine = openTasks.filter((t) => groupForTask(t, scope)?.id === group.id);
  const ctx = { today, now };
  const ranked = rankNextSteps(mine, ctx);
  return {
    group: {
      ...summary(group),
      archived: Boolean(group.archivedAt),
      mapped: Boolean(group.todoistProjectId),
      todoistProjectId: group.todoistProjectId,
      todoistSectionId: group.todoistSectionId,
    },
    nextStep: ranked[0] ?? null,
    alternatives: ranked.slice(1, 3),
    tree: sortTaskTree(mine, ctx),
    counts: countTasks(mine, ctx),
    doneThisWeek: completed
      .filter((t) => groupForTask(t, scope)?.id === group.id)
      .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? "")),
    weekStart: week.weekStart,
    today,
    otherGroups: allGroups.filter((g) => g.id !== group.id).map(summary),
  };
}

export async function assertGroupWritable(userId: string, slug: string) {
  return requireActiveGroup(userId, slug);
}

export type ScorecardData = {
  weekStart: string;
  weekEnd: string;
  isCurrentWeek: boolean;
  rows: ScoreRow[];
  chart: { day: string; label: string; [groupSlug: string]: number | string }[];
  chartGroups: GroupSummary[];
  review: Awaited<ReturnType<typeof getWeeklyReview>>;
  history: { weekStart: string; rows: ScoreRow[]; review: Awaited<ReturnType<typeof getWeeklyReview>> }[];
};

export async function getScorecard(userId: string, weekStartInput?: string, now = new Date()): Promise<ScorecardData> {
  const tz = env.APP_TIMEZONE;
  const current = weekRange(now, tz);
  const week = weekStartInput ? weekRangeFromStart(weekStartInput, tz) : current;

  const [groups, activity, targets, completed, review, reviews] = await Promise.all([
    listActiveGroups(userId),
    listActivity(userId, week.start, week.end),
    getTargets(userId, week.weekStart),
    listCompletedTasks(week.start.toISOString(), week.end.toISOString()).catch(() => []),
    getWeeklyReview(userId, week.weekStart),
    listWeeklyReviews(userId, 12),
  ]);

  const rows = computeScorecard(activity, targets);

  const chart = week.days.map((day) => {
    const point: ScorecardData["chart"][number] = { day, label: new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }) };
    for (const g of groups) point[g.slug] = 0;
    return point;
  });
  for (const t of completed) {
    const g = groupForTask(t, groups);
    if (!g || !t.completedAt) continue;
    const day = localDate(new Date(t.completedAt), tz);
    const point = chart.find((p) => p.day === day);
    if (point) point[g.slug] = Number(point[g.slug] ?? 0) + 1;
  }

  const pastWeeks = Array.from({ length: 6 }, (_, i) => addDays(week.weekStart, -7 * (i + 1)));
  const historyFrom = weekRangeFromStart(pastWeeks[pastWeeks.length - 1], tz).start;
  const pastActivity = await listActivity(userId, historyFrom, week.start);
  const history = await Promise.all(
    pastWeeks.map(async (ws) => {
      const r = weekRangeFromStart(ws, tz);
      const acts = pastActivity.filter((a) => a.occurredAt >= r.start && a.occurredAt < r.end);
      return {
        weekStart: ws,
        rows: computeScorecard(acts, await getTargets(userId, ws)),
        review: reviews.find((rv) => rv.weekStart === ws) ?? null,
      };
    }),
  );

  return {
    weekStart: week.weekStart,
    weekEnd: week.weekEnd,
    isCurrentWeek: week.weekStart === current.weekStart,
    rows,
    chart,
    chartGroups: groups.map(summary),
    review,
    history,
  };
}
