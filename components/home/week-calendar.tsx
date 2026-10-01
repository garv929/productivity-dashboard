"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { toast } from "sonner";
import { Check, ChevronLeft, ChevronRight, CalendarX2, Repeat } from "lucide-react";
import type { WeekAgenda } from "@/lib/services/agenda";
import { layoutLanes, type AgendaDay, type AgendaEvent, type AgendaTask } from "@/lib/domain/agenda";
import { addDays } from "@/lib/domain/time";
import { completeTaskAction } from "@/app/actions/tasks";
import { unwrap } from "@/lib/client/fetcher";
import { formatTime } from "@/lib/client/format";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const utc = (d: string) => new Date(`${d}T12:00:00Z`);
const fmt = (d: string, opts: Intl.DateTimeFormatOptions) => utc(d).toLocaleDateString("en-US", { ...opts, timeZone: "UTC" });

function rangeLabel(start: string, end: string) {
  const sameMonth = start.slice(0, 7) === end.slice(0, 7);
  return `${fmt(start, { month: "short", day: "numeric" })} – ${fmt(end, sameMonth ? { day: "numeric" } : { month: "short", day: "numeric" })}`;
}

export function WeekCalendar() {
  const [weekOf, setWeekOf] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const key = weekOf ? `/api/agenda?week=${weekOf}` : "/api/agenda";
  const { data, error, mutate, isLoading } = useSWR<WeekAgenda>(key, { keepPreviousData: true });

  const go = (deltaWeeks: number | null) => {
    setSelected(null);
    setWeekOf(deltaWeeks === null || !data ? null : addDays(data.weekStart, deltaWeeks * 7));
  };

  const complete = async (t: AgendaTask) => {
    const without = (cur: WeekAgenda | undefined) =>
      cur && { ...cur, days: cur.days.map((d) => ({ ...d, items: d.items.filter((i) => i.key !== t.key) })) };
    try {
      await mutate(
        async () => {
          unwrap(await completeTaskAction(t.id));
          return undefined;
        },
        { optimisticData: (cur) => without(cur)!, rollbackOnError: true, populateCache: false, revalidate: true },
      );
      toast.success(`Completed “${t.content.length > 60 ? `${t.content.slice(0, 59)}…` : t.content}”`);
    } catch {
      /* unwrap already toasted; SWR rolled back */
    }
  };

  const selectedDay = data ? (selected ?? (data.days.some((d) => d.date === data.today) ? data.today : data.weekStart)) : null;
  const isCurrentWeek = data ? data.today >= data.weekStart && data.today <= data.weekEnd : true;

  const wideScroll = useRef<HTMLDivElement>(null);
  const narrowScroll = useRef<HTMLDivElement>(null);
  const loaded = Boolean(data);
  // Open the grid near "now" this week, or at the first event (default 8am) on other weeks.
  // Only when the week or day changes — not on every background refresh.
  useEffect(() => {
    if (!data) return;
    const visible = selectedDay && !wideScroll.current?.offsetParent ? data.days.filter((d) => d.date === selectedDay) : data.days;
    const firstTimed = Math.min(
      ...visible.flatMap((d) => d.items.map((i) => i.startMin ?? Infinity)),
      8 * 60,
    );
    const target = isCurrentWeek ? data.nowMin - 90 : firstTimed - 30;
    for (const el of [wideScroll.current, narrowScroll.current]) {
      if (el) el.scrollTop = Math.max(0, (target / 60) * HOUR_PX);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, data?.weekStart, selectedDay]);

  return (
    <section aria-labelledby="calendar-heading" className="overflow-hidden rounded-xl border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
        <h2 id="calendar-heading" className="font-sans text-sm font-medium">
          Calendar
        </h2>
        {data && <span className="text-sm text-muted-foreground">{rangeLabel(data.weekStart, data.weekEnd)}</span>}
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" onClick={() => go(-1)} disabled={!data} aria-label="Previous week">
            <ChevronLeft />
          </Button>
          <Button variant="outline" size="sm" className="h-7" onClick={() => go(null)} disabled={isCurrentWeek}>
            Today
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={() => go(1)} disabled={!data} aria-label="Next week">
            <ChevronRight />
          </Button>
        </div>
      </div>

      {data && data.calendarStatus !== "ok" && (
        <div className="flex flex-wrap items-center gap-2 border-b bg-surface px-4 py-2 text-xs text-muted-foreground">
          <CalendarX2 className="size-3.5" />
          <span>{data.calendarMessage ?? "Google Calendar is unavailable."} Showing tasks only.</span>
          {data.calendarStatus === "needs-login" && (
            <Link href="/settings" className="ml-auto text-primary hover:underline">
              Re-connect
            </Link>
          )}
        </div>
      )}

      {!data ? (
        error ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">Couldn&apos;t load the calendar. It will retry automatically.</p>
        ) : (
          <Skeleton className="m-4 h-[min(68vh,720px)] rounded-lg" />
        )
      ) : (
        <div className={cn(isLoading && "opacity-60 transition-opacity")}>
          {/* Wide: week time grid. */}
          <div className="hidden xl:block">
            <div className={cn(COLS_7, "border-b")}>
              <div />
              {data.days.map((d) => (
                <DayHeader key={d.date} date={d.date} today={data.today} />
              ))}
            </div>
            <AllDayRow days={data.days} today={data.today} onComplete={complete} cols={COLS_7} />
            <div ref={wideScroll} className={SCROLL}>
              <TimeGrid days={data.days} agenda={data} onComplete={complete} cols={COLS_7} />
            </div>
          </div>

          {/* Narrow: day picker + one day's time grid. */}
          <div className="xl:hidden">
            <div className="grid grid-cols-7 gap-1 border-b px-2 py-2">
              {data.days.map((d) => {
                const active = d.date === selectedDay;
                const isToday = d.date === data.today;
                return (
                  <button
                    key={d.date}
                    onClick={() => setSelected(d.date)}
                    aria-pressed={active}
                    className={cn(
                      "flex flex-col items-center rounded-lg py-1.5 text-xs transition-colors",
                      active ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60",
                    )}
                  >
                    <span>{fmt(d.date, { weekday: "short" })}</span>
                    <span className={cn("mt-0.5 flex size-6 items-center justify-center rounded-full text-sm", isToday && "bg-primary text-primary-foreground")}>
                      {Number(d.date.slice(8))}
                    </span>
                    <span className={cn("mt-0.5 size-1 rounded-full", d.items.length ? "bg-muted-foreground/60" : "bg-transparent")} />
                  </button>
                );
              })}
            </div>
            {data.days
              .filter((d) => d.date === selectedDay)
              .map((d) => (
                <div key={d.date}>
                  <AllDayRow days={[d]} today={data.today} onComplete={complete} cols={COLS_1} />
                  <div ref={narrowScroll} className={SCROLL}>
                    <TimeGrid days={[d]} agenda={data} onComplete={complete} cols={COLS_1} />
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}
    </section>
  );
}

const HOUR_PX = 52;
const MIN_BLOCK_PX = 22;
const COLS_7 = "grid grid-cols-[3.25rem_repeat(7,minmax(0,1fr))]";
const COLS_1 = "grid grid-cols-[3.25rem_minmax(0,1fr)]";
const SCROLL = "h-[min(68vh,720px)] overflow-y-auto overscroll-contain";
const HOURS = Array.from({ length: 23 }, (_, i) => i + 1);

function hourLabel(h: number) {
  return h === 12 ? "12 PM" : h < 12 ? `${h} AM` : `${h - 12} PM`;
}

function DayHeader({ date, today }: { date: string; today: string }) {
  const isToday = date === today;
  return (
    <div className="flex items-center justify-center gap-1.5 border-l py-2">
      <span className={cn("text-xs", isToday ? "font-medium text-primary" : "text-muted-foreground")}>{fmt(date, { weekday: "short" })}</span>
      <span
        className={cn(
          "flex size-7 items-center justify-center rounded-full text-sm",
          isToday ? "bg-primary text-primary-foreground" : date < today ? "text-muted-foreground" : "text-foreground",
        )}
      >
        {Number(date.slice(8))}
      </span>
    </div>
  );
}

/** All-day events plus tasks with no time (overdue ones included). */
function AllDayRow({ days, today, onComplete, cols }: { days: AgendaDay[]; today: string; onComplete: (t: AgendaTask) => void; cols: string }) {
  const untimed = days.map((d) => d.items.filter((i) => i.startMin === null));
  if (untimed.every((items) => items.length === 0)) return null;
  return (
    <div className={cn(cols, "border-b")}>
      <div className="px-1 pt-2 text-right text-[10px] leading-tight text-muted-foreground">All day</div>
      {days.map((d, i) => (
        <ul key={d.date} className={cn("min-w-0 space-y-1 border-l p-1", d.date === today && "bg-primary/[0.03]")}>
          {untimed[i].map((item) =>
            item.kind === "event" ? (
              <li key={item.key}>
                <EventLink event={item}>
                  <div
                    className="truncate rounded-md px-1.5 py-0.5 text-xs"
                    style={{ backgroundColor: tint(item.color), borderLeft: `3px solid ${item.color ?? "var(--muted-foreground)"}` }}
                  >
                    {item.title}
                  </div>
                </EventLink>
              </li>
            ) : (
              <li key={item.key} className="group/task flex items-start gap-1.5 rounded-md px-1 py-0.5 hover:bg-accent/60">
                <CompleteButton task={item} onComplete={onComplete} />
                <Link href={`/g/${item.group.slug}`} className="min-w-0 flex-1" title={item.content}>
                  <p className="truncate text-xs">{item.content}</p>
                  {item.overdue && <p className="text-[10px] text-destructive">Overdue · {fmt(item.dueDate, { month: "short", day: "numeric" })}</p>}
                </Link>
              </li>
            ),
          )}
        </ul>
      ))}
    </div>
  );
}

function TimeGrid({ days, agenda, onComplete, cols }: { days: AgendaDay[]; agenda: WeekAgenda; onComplete: (t: AgendaTask) => void; cols: string }) {
  const height = 24 * HOUR_PX;
  const minMinutes = (MIN_BLOCK_PX / HOUR_PX) * 60;
  return (
    <div className={cols} style={{ height }}>
      <div className="relative">
        {HOURS.map((h) => (
          <span key={h} className="absolute right-2 -translate-y-1/2 text-[10px] whitespace-nowrap text-muted-foreground" style={{ top: h * HOUR_PX }}>
            {hourLabel(h)}
          </span>
        ))}
      </div>
      {days.map((d) => {
        const isToday = d.date === agenda.today;
        return (
          <div
            key={d.date}
            className={cn("relative border-l", isToday && "bg-primary/[0.03]")}
            style={{
              backgroundImage: "linear-gradient(to bottom, var(--border) 1px, transparent 1px)",
              backgroundSize: `100% ${HOUR_PX}px`,
            }}
          >
            {layoutLanes(d.items, minMinutes).map(({ item, lane, lanes }) => {
              const top = (item.startMin! / 60) * HOUR_PX;
              const h = Math.max(((item.endMin! - item.startMin!) / 60) * HOUR_PX, MIN_BLOCK_PX);
              const style = {
                top: top + 1,
                height: h - 2,
                left: `calc(${(lane / lanes) * 100}% + 2px)`,
                width: `calc(${100 / lanes}% - 4px)`,
              };
              return item.kind === "event" ? (
                <EventBlock key={item.key} event={item} style={style} tall={h >= 40} tz={agenda.tz} past={isPast(agenda, d.date, item.endMin!)} />
              ) : (
                <TaskBlock key={item.key} task={item} style={style} tall={h >= 40} tz={agenda.tz} onComplete={onComplete} />
              );
            })}
            {isToday && agenda.today >= agenda.weekStart && (
              <div className="pointer-events-none absolute inset-x-0 z-10 flex items-center" style={{ top: (agenda.nowMin / 60) * HOUR_PX }}>
                <span className="-ml-1 size-2 rounded-full bg-destructive" />
                <span className="h-px flex-1 bg-destructive" />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function isPast(agenda: WeekAgenda, date: string, endMin: number) {
  return date < agenda.today || (date === agenda.today && endMin <= agenda.nowMin);
}

/** Group colour at low opacity for event backgrounds; neutral when the event isn't a group block. */
function tint(color: string | null) {
  return color ? `color-mix(in oklab, ${color} 18%, transparent)` : "var(--surface)";
}

function EventLink({ event: e, children }: { event: AgendaEvent; children: React.ReactNode }) {
  return e.groupSlug ? <Link href={`/g/${e.groupSlug}`}>{children}</Link> : <>{children}</>;
}

function EventBlock({ event: e, style, tall, tz, past }: { event: AgendaEvent; style: React.CSSProperties; tall: boolean; tz: string; past: boolean }) {
  const when = `${formatTime(e.start, tz)} – ${formatTime(e.end, tz)}`;
  return (
    <div className={cn("absolute overflow-hidden", past && "opacity-55")} style={style} title={`${e.title}\n${when}`}>
      <EventLink event={e}>
        <div
          className={cn("h-full rounded-md px-1.5 text-xs leading-tight", tall ? "py-1" : "flex items-center gap-1", e.groupSlug && "hover:brightness-110")}
          style={{ backgroundColor: tint(e.color), borderLeft: `3px solid ${e.color ?? "var(--muted-foreground)"}` }}
        >
          <p className={cn("font-medium", tall ? "line-clamp-2" : "truncate")}>{e.title}</p>
          <p className={cn("text-[10px] text-muted-foreground", !tall && "shrink-0")}>{tall ? when : formatTime(e.start, tz)}</p>
        </div>
      </EventLink>
    </div>
  );
}

function TaskBlock({ task: t, style, tall, tz, onComplete }: { task: AgendaTask; style: React.CSSProperties; tall: boolean; tz: string; onComplete: (t: AgendaTask) => void }) {
  return (
    <div
      className="group/task absolute z-[1] flex items-start gap-1.5 overflow-hidden rounded-md border bg-card px-1.5 py-1 text-xs shadow-sm"
      style={{ ...style, borderColor: `color-mix(in oklab, ${t.group.color} 55%, transparent)` }}
      title={`${t.content}\n${t.group.name}`}
    >
      <CompleteButton task={t} onComplete={onComplete} />
      <Link href={`/g/${t.group.slug}`} className="min-w-0 flex-1 leading-tight">
        <p className={cn(tall ? "line-clamp-2" : "truncate")}>{t.content}</p>
        {tall && (
          <p className="flex items-center gap-1 text-[10px] text-muted-foreground">
            {t.time && formatTime(t.time, tz)}
            {t.recurring && <Repeat className="size-2.5" aria-label="Recurring" />}
          </p>
        )}
      </Link>
    </div>
  );
}

function CompleteButton({ task: t, onComplete }: { task: AgendaTask; onComplete: (t: AgendaTask) => void }) {
  return (
    <button
      onClick={() => onComplete(t)}
      aria-label={`Complete “${t.content}”`}
      className="mt-px flex size-3.5 shrink-0 items-center justify-center rounded-full border-[1.5px] transition-colors hover:bg-muted"
      style={{ borderColor: t.group.color }}
    >
      <Check className="size-2 opacity-0 group-hover/task:opacity-60" />
    </button>
  );
}
