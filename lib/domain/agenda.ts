import type { TaskLite } from "@/lib/todoist/types";
import { localDate, startOfLocalDay, addDays, type LocalDate } from "./time";

/** Google Calendar events and dashboard Todoist tasks merged into one list per day. */

export type AgendaEventInput = {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  color: string | null;
  groupSlug: string | null;
};

export type AgendaGroup = { slug: string; name: string; color: string };

/** Minutes since local midnight, clipped to the day. Null for all-day / untimed items. */
export type DaySpan = { startMin: number | null; endMin: number | null };

export type AgendaEvent = { kind: "event"; key: string } & AgendaEventInput & DaySpan;

export type AgendaTask = {
  kind: "task";
  key: string;
  id: string;
  content: string;
  /** ISO instant for timed tasks, null for date-only. */
  time: string | null;
  dueDate: LocalDate;
  overdue: boolean;
  recurring: boolean;
  priority: number;
  group: AgendaGroup;
} & DaySpan;

export type AgendaItem = AgendaEvent | AgendaTask;

export type AgendaDay = { date: LocalDate; items: AgendaItem[] };

/** Length given to timed tasks that have no Todoist duration. */
export const DEFAULT_TASK_MINUTES = 30;
const DAY_MINUTES = 24 * 60;

const clampMin = (m: number) => Math.min(DAY_MINUTES, Math.max(0, Math.round(m)));

/** Untimed things first (all-day events, then date-only tasks), then by start time. */
function sortKey(item: AgendaItem): [number, number, string] {
  if (item.kind === "event") {
    return item.allDay ? [0, 0, item.title] : [2, new Date(item.start).getTime(), item.title];
  }
  if (!item.time) return [1, item.overdue ? 0 : 1, item.content];
  return [2, new Date(item.time).getTime(), item.content];
}

function compare(a: AgendaItem, b: AgendaItem): number {
  const [a0, a1, a2] = sortKey(a);
  const [b0, b1, b2] = sortKey(b);
  return a0 - b0 || a1 - b1 || a2.localeCompare(b2);
}

/**
 * Lays events and tasks out over `days`. Events show on every day they overlap
 * (multi-day events repeat, timed ones clipped to each day). Tasks show on their due date; overdue
 * tasks are pulled onto `today` when it's in range. Tasks without a due date
 * have no place on a calendar and are skipped.
 */
export function buildAgenda({
  days,
  today,
  tz,
  events,
  tasks,
}: {
  days: LocalDate[];
  today: LocalDate;
  tz: string;
  events: AgendaEventInput[];
  tasks: { task: TaskLite; group: AgendaGroup }[];
}): AgendaDay[] {
  const out = new Map<LocalDate, AgendaItem[]>(days.map((d) => [d, []]));

  for (const ev of events) {
    const s = new Date(ev.start).getTime();
    const e = Math.max(new Date(ev.end).getTime(), s + 1);
    for (const day of days) {
      const dayStart = startOfLocalDay(day, tz).getTime();
      const dayEnd = startOfLocalDay(addDays(day, 1), tz).getTime();
      if (!(s < dayEnd && e > dayStart)) continue;
      const span: DaySpan = ev.allDay
        ? { startMin: null, endMin: null }
        : { startMin: clampMin((s - dayStart) / 60_000), endMin: clampMin((e - dayStart) / 60_000) };
      out.get(day)!.push({ kind: "event", key: `e:${ev.id}:${day}`, ...ev, ...span });
    }
  }

  for (const { task, group } of tasks) {
    if (!task.due) continue;
    const time = task.due.datetime ? new Date(task.due.datetime).toISOString() : null;
    const dueDate = time ? localDate(new Date(time), tz) : task.due.date;
    const overdue = dueDate < today;
    const day = overdue ? today : dueDate;
    const bucket = out.get(day);
    if (!bucket) continue;
    let span: DaySpan = { startMin: null, endMin: null };
    if (time && !overdue) {
      const startMin = clampMin((new Date(time).getTime() - startOfLocalDay(day, tz).getTime()) / 60_000);
      span = { startMin, endMin: clampMin(startMin + (task.durationMinutes ?? DEFAULT_TASK_MINUTES)) };
    }
    bucket.push({
      kind: "task",
      key: `t:${task.id}`,
      id: task.id,
      content: task.content,
      time: overdue ? null : time,
      dueDate,
      overdue,
      recurring: task.due.isRecurring,
      priority: task.priority,
      group,
      ...span,
    });
  }

  return days.map((date) => ({ date, items: out.get(date)!.sort(compare) }));
}

export type Placed<T> = { item: T; lane: number; lanes: number };

/**
 * Side-by-side columns for overlapping timed items in one day (like Google Calendar):
 * each cluster of mutually overlapping items is split into as many lanes as it needs.
 */
export function layoutLanes<T extends DaySpan>(items: T[], minMinutes = 0): Placed<T>[] {
  const timed = items
    .filter((i) => i.startMin !== null && i.endMin !== null)
    .map((item) => ({ item, start: item.startMin!, end: Math.max(item.endMin!, item.startMin! + minMinutes) }))
    .sort((a, b) => a.start - b.start || b.end - a.end);

  const out: Placed<T>[] = [];
  let cluster: { item: T; lane: number }[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = -1;
  const flush = () => {
    for (const c of cluster) out.push({ item: c.item, lane: c.lane, lanes: laneEnds.length });
    cluster = [];
    laneEnds = [];
  };
  for (const t of timed) {
    if (t.start >= clusterEnd) flush();
    let lane = laneEnds.findIndex((end) => end <= t.start);
    if (lane === -1) lane = laneEnds.push(t.end) - 1;
    else laneEnds[lane] = t.end;
    cluster.push({ item: t.item, lane });
    clusterEnd = Math.max(clusterEnd, t.end);
  }
  flush();
  return out;
}
