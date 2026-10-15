import "server-only";
import { env } from "@/lib/env";
import { getCalendarEvents, tagEvents, type CalendarStatus } from "@/lib/calendar";
import { listOpenTasks } from "@/lib/todoist";
import { listActiveGroups } from "@/lib/domain/groups";
import { groupForTask } from "@/lib/domain/group-mapping";
import { buildAgenda, type AgendaDay } from "@/lib/domain/agenda";
import { localDate, startOfLocalDay, weekRangeFromStart, type LocalDate } from "@/lib/domain/time";
import { listInterviews } from "./prep";

/** An interview from Interview Prep, placed on its local day for the homepage timeline. */
export type AgendaInterview = {
  id: string;
  date: LocalDate;
  /** ISO instant. */
  at: string;
  companyName: string | null;
  role: string | null;
  stage: string | null;
};

export type WeekAgenda = {
  generatedAt: string;
  /** Minutes since local midnight at generatedAt, for the now line. */
  nowMin: number;
  tz: string;
  today: LocalDate;
  weekStart: LocalDate;
  weekEnd: LocalDate;
  days: AgendaDay[];
  /** This week's interviews, soonest first. */
  interviews: AgendaInterview[];
  /** The Interview Prep page (link + colour for the timeline), if that group exists. */
  prep: { slug: string; color: string } | null;
  calendarStatus: CalendarStatus;
  calendarMessage?: string;
};

/**
 * Monday–Sunday agenda: every Google Calendar event, plus only the Todoist tasks
 * that live in a dashboard group's project/section (never the Inbox or other projects).
 */
export async function getWeekAgenda(userId: string, weekOf?: LocalDate, now = new Date()): Promise<WeekAgenda> {
  const tz = env.APP_TIMEZONE;
  const today = localDate(now, tz);
  const week = weekRangeFromStart(weekOf ?? today, tz);

  const [groups, calendar, openTasks, weekInterviews] = await Promise.all([
    listActiveGroups(userId),
    getCalendarEvents(userId, week.start, week.end),
    listOpenTasks(),
    listInterviews(userId, { from: week.start, to: week.end }),
  ]);
  const prepGroup = groups.find((g) => g.kind === "prep");

  const tasks = openTasks.flatMap((task) => {
    const g = groupForTask(task, groups);
    return g ? [{ task, group: { slug: g.slug, name: g.name, color: g.color } }] : [];
  });

  const days = buildAgenda({
    days: week.days,
    today,
    tz,
    events: tagEvents(calendar.events, groups).map((e) => ({
      id: e.id,
      title: e.title,
      start: e.start,
      end: e.end,
      allDay: e.allDay,
      description: e.description ?? null,
      color: e.color,
      groupSlug: e.groupSlug,
      groupName: e.groupName,
    })),
    tasks,
  });

  return {
    generatedAt: now.toISOString(),
    nowMin: Math.round((now.getTime() - startOfLocalDay(today, tz).getTime()) / 60_000),
    tz,
    today,
    weekStart: week.weekStart,
    weekEnd: week.weekEnd,
    days,
    interviews: weekInterviews.map((i) => ({
      id: i.id,
      date: localDate(i.scheduledAt, tz),
      at: i.scheduledAt.toISOString(),
      companyName: i.companyName,
      role: i.role,
      stage: i.stage,
    })),
    prep: prepGroup ? { slug: prepGroup.slug, color: prepGroup.color } : null,
    calendarStatus: calendar.status,
    calendarMessage: calendar.message,
  };
}
