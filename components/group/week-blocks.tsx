"use client";

import { useState } from "react";
import useSWR from "swr";
import { CalendarClock } from "lucide-react";
import type { WeekAgenda } from "@/lib/services/agenda";
import type { AgendaEvent } from "@/lib/domain/agenda";
import { formatTime } from "@/lib/client/format";
import { LinkifiedText } from "@/components/calendar/event-details";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const fmtDay = (d: string, opts: Intl.DateTimeFormatOptions) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { ...opts, timeZone: "UTC" });

function hoursLabel(minutes: number) {
  const h = minutes / 60;
  return `${Number.isInteger(h) ? h : h.toFixed(1)}h`;
}

/**
 * This week's Google Calendar blocks linked to the group (matched by the group's
 * calendar-title rules), with their descriptions. Shares /api/agenda with the home calendar.
 */
export function WeekBlocks({ slug, color }: { slug: string; color: string }) {
  const { data, error } = useSWR<WeekAgenda>("/api/agenda");

  let body: React.ReactNode;
  if (!data) {
    body = error ? (
      <p className="text-sm text-muted-foreground">Couldn&apos;t load your calendar. It will retry automatically.</p>
    ) : (
      <Skeleton className="h-20 rounded-xl" />
    );
  } else if (data.calendarStatus !== "ok") {
    body = <p className="text-sm text-muted-foreground">{data.calendarMessage ?? "Google Calendar is unavailable right now."}</p>;
  } else {
    // An event spanning several days appears once per day in the agenda; list it once.
    const seen = new Set<string>();
    const blocks: (AgendaEvent & { date: string })[] = [];
    for (const day of data.days) {
      for (const item of day.items) {
        if (item.kind !== "event" || item.groupSlug !== slug || seen.has(item.id)) continue;
        seen.add(item.id);
        blocks.push({ ...item, date: day.date });
      }
    }
    const nowMs = new Date(data.generatedAt).getTime();
    const minutes = blocks.reduce((sum, b) => sum + (b.allDay ? 0 : (new Date(b.end).getTime() - new Date(b.start).getTime()) / 60_000), 0);
    const doneMinutes = blocks.reduce(
      (sum, b) => sum + (b.allDay ? 0 : Math.max(0, Math.min(nowMs, new Date(b.end).getTime()) - new Date(b.start).getTime()) / 60_000),
      0,
    );

    body =
      blocks.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-5 text-sm text-muted-foreground">
          No calendar blocks for this group this week. Blocks link here when their title matches this group&apos;s calendar rule (see{" "}
          <a href="/settings" className="text-primary hover:underline">Settings</a>).
        </p>
      ) : (
        <>
          <p className="-mt-1 mb-3 text-xs text-muted-foreground">
            {blocks.length} block{blocks.length === 1 ? "" : "s"} · {hoursLabel(minutes)} planned · {hoursLabel(doneMinutes)} so far
          </p>
          <ul className="divide-y overflow-hidden rounded-xl border bg-card">
            {blocks.map((b) => (
              <BlockRow key={b.key} block={b} tz={data.tz} today={data.today} nowMs={nowMs} color={color} />
            ))}
          </ul>
        </>
      );
  }

  return (
    <section aria-labelledby="week-blocks">
      <div className="mb-3 flex items-center gap-2">
        <CalendarClock className="size-4 text-muted-foreground" />
        <h2 id="week-blocks" className="text-xl">
          This week&apos;s calendar blocks
        </h2>
        {data && <span className="ml-auto text-xs text-muted-foreground">{fmtDay(data.weekStart, { month: "short", day: "numeric" })} – {fmtDay(data.weekEnd, { month: "short", day: "numeric" })}</span>}
      </div>
      {body}
    </section>
  );
}

function BlockRow({ block: b, tz, today, nowMs, color }: { block: AgendaEvent & { date: string }; tz: string; today: string; nowMs: number; color: string }) {
  const [expanded, setExpanded] = useState(false);
  const start = new Date(b.start).getTime();
  const end = new Date(b.end).getTime();
  const past = end <= nowMs;
  const now = start <= nowMs && nowMs < end;
  const long = (b.description?.length ?? 0) > 180 || (b.description?.split("\n").length ?? 0) > 3;

  return (
    <li className={cn("flex gap-4 px-4 py-3", now && "bg-primary/[0.04]")}>
      <div className={cn("w-16 shrink-0 text-center", past && "opacity-55")}>
        <p className={cn("text-xs", b.date === today ? "font-medium text-primary" : "text-muted-foreground")}>{fmtDay(b.date, { weekday: "short" })}</p>
        <p className="font-serif text-2xl leading-none">{Number(b.date.slice(8))}</p>
      </div>
      <div className="min-w-0 flex-1 border-l-[3px] pl-3" style={{ borderLeftColor: b.color ?? color }}>
        <div className={cn("flex flex-wrap items-baseline gap-x-2", past && "opacity-55")}>
          <p className="font-medium">{b.title}</p>
          <p className="text-xs text-muted-foreground">{b.allDay ? "All day" : `${formatTime(b.start, tz)} – ${formatTime(b.end, tz)}`}</p>
          {now && <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-medium text-primary-foreground">Now</span>}
          {past && <span className="text-[10px] text-muted-foreground">Done</span>}
        </div>
        {b.description && (
          <div className={cn("mt-1.5 text-sm text-muted-foreground", past && "opacity-70")}>
            <LinkifiedText text={b.description} className={cn(!expanded && long && "line-clamp-3")} />
            {long && (
              <button onClick={() => setExpanded((v) => !v)} className="mt-1 text-xs text-primary hover:underline">
                {expanded ? "Show less" : "Show more"}
              </button>
            )}
          </div>
        )}
      </div>
    </li>
  );
}
