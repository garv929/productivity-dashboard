import "server-only";
import { env } from "@/lib/env";
import { getCalendarEvents, tagEvents, type CalendarStatus } from "@/lib/calendar";
import { listOpenTasks } from "@/lib/todoist";
import { listActiveGroups } from "@/lib/domain/groups";
import { groupForTask } from "@/lib/domain/group-mapping";
import { buildAgenda, type AgendaDay } from "@/lib/domain/agenda";
import { localDate, startOfLocalDay, weekRangeFromStart, type LocalDate } from "@/lib/domain/time";

export type WeekAgenda = {
  generatedAt: string;
  /** Minutes since local midnight at generatedAt, for the now line. */
  nowMin: number;
  tz: string;
  today: LocalDate;
  weekStart: LocalDate;
  weekEnd: LocalDate;
  days: AgendaDay[];
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

  const [groups, calendar, openTasks] = await Promise.all([
    listActiveGroups(userId),
    getCalendarEvents(userId, week.start, week.end),
    listOpenTasks(),
  ]);

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
      color: e.color,
      groupSlug: e.groupSlug,
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
    calendarStatus: calendar.status,
    calendarMessage: calendar.message,
  };
}
