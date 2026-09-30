import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

/** A calendar date in the app timezone, `YYYY-MM-DD`. */
export type LocalDate = string;

export function localDate(instant: Date, tz: string): LocalDate {
  return formatInTimeZone(instant, tz, "yyyy-MM-dd");
}

export function localTime(instant: Date, tz: string): string {
  return formatInTimeZone(instant, tz, "HH:mm");
}

/** Pure calendar arithmetic on `YYYY-MM-DD` (no timezone involved). */
export function addDays(date: LocalDate, days: number): LocalDate {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/** ISO weekday of a local date: 1 = Monday … 7 = Sunday. */
export function isoWeekday(date: LocalDate): number {
  const [y, m, d] = date.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return dow === 0 ? 7 : dow;
}

export function diffDays(a: LocalDate, b: LocalDate): number {
  const toMs = (s: LocalDate) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toMs(a) - toMs(b)) / 86_400_000);
}

/** The instant local midnight starts on `date` in `tz` (DST-safe: each boundary resolved on its own). */
export function startOfLocalDay(date: LocalDate, tz: string): Date {
  return fromZonedTime(`${date}T00:00:00`, tz);
}

export function localDateTimeToInstant(date: LocalDate, time: string, tz: string): Date {
  return fromZonedTime(`${date}T${time.length === 5 ? `${time}:00` : time}`, tz);
}

export type DayRange = { date: LocalDate; start: Date; end: Date };

export function dayRange(date: LocalDate, tz: string): DayRange {
  return { date, start: startOfLocalDay(date, tz), end: startOfLocalDay(addDays(date, 1), tz) };
}

export type WeekRange = {
  /** Monday, `YYYY-MM-DD`. */
  weekStart: LocalDate;
  /** Sunday, `YYYY-MM-DD`. */
  weekEnd: LocalDate;
  /** Monday 00:00 local, as an instant. */
  start: Date;
  /** Next Monday 00:00 local, as an instant (exclusive). */
  end: Date;
  days: LocalDate[];
};

/** Monday–Sunday week containing `instant`, in `tz`. */
export function weekRange(instant: Date, tz: string): WeekRange {
  return weekRangeFromStart(mondayOf(localDate(instant, tz)), tz);
}

export function mondayOf(date: LocalDate): LocalDate {
  return addDays(date, 1 - isoWeekday(date));
}

export function weekRangeFromStart(weekStart: LocalDate, tz: string): WeekRange {
  const monday = mondayOf(weekStart);
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  return {
    weekStart: monday,
    weekEnd: days[6],
    start: startOfLocalDay(monday, tz),
    end: startOfLocalDay(addDays(monday, 7), tz),
    days,
  };
}

export function isWeekend(date: LocalDate): boolean {
  return isoWeekday(date) >= 6;
}

export function formatLocal(instant: Date | string, tz: string, pattern: string): string {
  return formatInTimeZone(typeof instant === "string" ? new Date(instant) : instant, tz, pattern);
}

/** "Today 9:45–11:30", "Tomorrow 9:45–11:30", "Thu 9:45–11:30". */
export function describeBlock(start: Date | string, end: Date | string, now: Date, tz: string): string {
  const s = typeof start === "string" ? new Date(start) : start;
  const e = typeof end === "string" ? new Date(end) : end;
  const today = localDate(now, tz);
  const day = localDate(s, tz);
  const dayLabel =
    day === today ? "Today" : day === addDays(today, 1) ? "Tomorrow" : formatInTimeZone(s, tz, "EEE MMM d");
  const t = (d: Date) => formatInTimeZone(d, tz, "h:mm").replace(":00", "");
  return `${dayLabel} ${t(s)}–${t(e)}`;
}
