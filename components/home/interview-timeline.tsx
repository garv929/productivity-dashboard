"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Briefcase, ChevronLeft, ChevronRight } from "lucide-react";
import type { InterviewWeek } from "@/lib/services/interview-week";
import { addDays, mondayOf } from "@/lib/domain/time";
import { formatTime } from "@/lib/client/format";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const fmtDay = (d: string, opts: Intl.DateTimeFormatOptions) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { ...opts, timeZone: "UTC" });
const FALLBACK_INTERVIEW = "var(--primary)";
/** Used for calls when the Networking colour is too close to the interview colour (the defaults are both blue). */
const NETWORKING_FALLBACKS = ["#14b8a6", "#f59e0b"]; // teal, then amber

/** Hue in degrees of a #rrggbb colour, or null for anything else (e.g. CSS variables). */
function hue(color: string): number | null {
  const m = /^#([0-9a-f]{6})$/i.exec(color);
  if (!m) return null;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

/** First candidate whose hue is at least 45° away from `base`, so calls never look like interviews. */
function distinctColor(base: string, candidates: (string | null | undefined)[]): string {
  const hb = hue(base);
  for (const c of candidates) {
    if (!c) continue;
    const hc = hue(c);
    if (hb === null || hc === null) return c;
    const diff = Math.abs(hb - hc);
    if (Math.min(diff, 360 - diff) >= 45) return c;
  }
  return NETWORKING_FALLBACKS[0];
}

/** One timeline entry: an interview or a networking call. */
type Item = {
  key: string;
  kind: "interview" | "call";
  date: string;
  at: string;
  /** Company for interviews, the person for calls. */
  title: string;
  /** Role for interviews, company for calls. */
  detail: string | null;
  stage: string | null;
  href: string | null;
  color: string;
};

function rangeLabel(start: string, end: string) {
  const sameMonth = start.slice(0, 7) === end.slice(0, 7);
  return `${fmtDay(start, { month: "short", day: "numeric" })} – ${fmtDay(end, sameMonth ? { day: "numeric" } : { month: "short", day: "numeric" })}`;
}

/**
 * Interviews (from Interview Prep) and networking calls (from Networking) for one week,
 * above the week calendar, each kind in its group's colour. It starts on the
 * calendar's week and follows it until you use its own arrows; then it's independent. The
 * choice isn't stored, so reloading or leaving Home snaps it back to the calendar's week.
 * On wide screens it uses the calendar's column template so each day sits over its column.
 */
export function InterviewTimeline({ calendarWeek, cols }: { calendarWeek: string; cols: string }) {
  const [ownWeek, setOwnWeek] = useState<string | null>(null);
  const week = ownWeek ?? calendarWeek;
  const { data, isLoading } = useSWR<InterviewWeek>(`/api/interviews?week=${week}`, { keepPreviousData: true });

  const thisWeek = data ? mondayOf(data.today) : null;
  const isCurrentWeek = data ? data.weekStart === thisWeek : true;
  const go = (deltaWeeks: number) => setOwnWeek(addDays(data?.weekStart ?? week, deltaWeeks * 7));

  const interviewColor = data?.prep?.color ?? FALLBACK_INTERVIEW;
  const callColor = distinctColor(interviewColor, [data?.networking?.color, ...NETWORKING_FALLBACKS]);
  const href = data?.prep ? `/g/${data.prep.slug}` : null;
  const items: Item[] = data
    ? [
        ...data.interviews.map((i) => ({
          key: `i-${i.id}`,
          kind: "interview" as const,
          date: i.date,
          at: i.at,
          title: i.companyName ?? "Interview",
          detail: i.role,
          stage: i.stage,
          href,
          color: interviewColor,
        })),
        ...data.calls.map((c) => ({
          key: `c-${c.id}`,
          kind: "call" as const,
          date: c.date,
          at: c.at,
          title: c.personName,
          detail: c.company,
          stage: null,
          href: data.networking ? `/g/${data.networking.slug}` : null,
          color: callColor,
        })),
      ].sort((a, b) => a.at.localeCompare(b.at))
    : [];
  const count = items.length;
  const byDay = new Map((data?.days ?? []).map((d) => [d, items.filter((i) => i.date === d)]));

  return (
    <section aria-labelledby="interviews-heading" className="overflow-hidden rounded-xl border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
        <Briefcase className="size-3.5 text-muted-foreground" />
        <h2 id="interviews-heading" className="font-sans text-sm font-medium">
          Interviews &amp; networking
        </h2>
        {data && <span className="text-sm text-muted-foreground">{rangeLabel(data.weekStart, data.weekEnd)}</span>}
        {data && <span className="text-xs text-muted-foreground">· {count === 0 ? "none" : count}</span>}
        <div className="ml-auto flex items-center gap-1">
          <span className="mr-2 hidden items-center gap-3 text-xs text-muted-foreground sm:inline-flex">
            <KeyDot color={interviewColor} label="Interviews" href={href} />
            <KeyDot color={callColor} label="Networking" href={data?.networking ? `/g/${data.networking.slug}` : null} />
          </span>
          <Button variant="ghost" size="icon-sm" onClick={() => go(-1)} disabled={!data} aria-label="Previous week of interviews">
            <ChevronLeft />
          </Button>
          <Button variant="outline" size="sm" className="h-7" onClick={() => thisWeek && setOwnWeek(thisWeek)} disabled={!data || isCurrentWeek}>
            Today
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={() => go(1)} disabled={!data} aria-label="Next week of interviews">
            <ChevronRight />
          </Button>
        </div>
      </div>

      {!data ? (
        <div className="h-[4.5rem]" />
      ) : (
        <div className={cn(isLoading && "opacity-60 transition-opacity")}>
          {/* Wide: its own day headers, then one cell per day, aligned with the calendar's columns. */}
          <div className="hidden @4xl:block">
            <div className={cn(cols, "border-b")}>
              <div />
              {data.days.map((d) => {
                const isToday = d === data.today;
                return (
                  <div key={d} className="flex items-center justify-center gap-1 border-l py-1 text-xs">
                    <span className={isToday ? "font-medium text-primary" : "text-muted-foreground"}>{fmtDay(d, { weekday: "short" })}</span>
                    <span className={cn(isToday ? "font-medium text-primary" : d < data.today ? "text-muted-foreground" : "text-foreground")}>
                      {Number(d.slice(8))}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className={cn(cols, "min-h-10")}>
              <div />
              {data.days.map((d) => (
                <ul key={d} className={cn("min-w-0 space-y-1 border-l p-1", d === data.today && "bg-primary/[0.03]")} aria-label={fmtDay(d, { weekday: "long", month: "short", day: "numeric" })}>
                  {byDay.get(d)!.map((it) => (
                    <li key={it.key}>
                      <TimelineChip item={it} tz={data.tz} past={it.at < data.generatedAt} />
                    </li>
                  ))}
                </ul>
              ))}
            </div>
          </div>

          {/* Narrow: the week's interviews as a short list. */}
          <div className="@4xl:hidden">
            {count === 0 ? (
              <p className="px-4 py-2 text-xs text-muted-foreground">No interviews or networking calls this week.</p>
            ) : (
              <ul className="divide-y">
                {items.map((it) => (
                  <li key={it.key} className="flex items-center gap-3 px-4 py-1.5 text-xs">
                    <span className={cn("w-16 shrink-0", it.date === data.today ? "font-medium text-primary" : "text-muted-foreground")}>
                      {it.date === data.today ? "Today" : `${fmtDay(it.date, { weekday: "short" })} ${Number(it.date.slice(8))}`}
                    </span>
                    <TimelineChip item={it} tz={data.tz} past={it.at < data.generatedAt} inline />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

/** "● Interviews" key entry; links to that page when it exists. */
function KeyDot({ color, label, href }: { color: string; label: string; href: string | null }) {
  const body = (
    <>
      <span className="inline-block size-2 rounded-full" style={{ backgroundColor: color }} aria-hidden />
      {label}
    </>
  );
  return href ? (
    <Link href={href} className="inline-flex items-center gap-1.5 hover:text-foreground hover:underline">
      {body}
    </Link>
  ) : (
    <span className="inline-flex items-center gap-1.5">{body}</span>
  );
}

function TimelineChip({ item: it, tz, past, inline = false }: { item: Item; tz: string; past: boolean; inline?: boolean }) {
  const kindLabel = it.kind === "interview" ? "Interview" : "Networking call";
  const tooltip = [`${kindLabel}: ${it.title}${it.detail ? ` – ${it.detail}` : ""}`, formatTime(it.at, tz), it.stage].filter(Boolean).join("\n");
  const body = (
    <>
      <span className="shrink-0 font-medium tabular-nums">{formatTime(it.at, tz)}</span>
      <span className="min-w-0 truncate">
        <span className="sr-only">{kindLabel}: </span>
        {it.title}
        {it.detail && <span className="text-muted-foreground"> · {it.detail}</span>}
      </span>
    </>
  );
  const className = cn(
    "flex min-w-0 items-baseline gap-1.5 rounded-md px-1.5 py-0.5 text-xs hover:brightness-110",
    inline ? "flex-1" : "w-full",
    past && "opacity-55",
  );
  const style = { backgroundColor: `color-mix(in oklab, ${it.color} 16%, transparent)`, borderLeft: `3px solid ${it.color}` };
  return it.href ? (
    <Link href={it.href} className={className} style={style} title={tooltip}>
      {body}
    </Link>
  ) : (
    <span className={className} style={style} title={tooltip}>
      {body}
    </span>
  );
}
