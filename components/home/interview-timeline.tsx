"use client";

import Link from "next/link";
import { Briefcase } from "lucide-react";
import type { AgendaInterview, WeekAgenda } from "@/lib/services/agenda";
import { formatTime } from "@/lib/client/format";
import { cn } from "@/lib/utils";

const fmtDay = (d: string, opts: Intl.DateTimeFormatOptions) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { ...opts, timeZone: "UTC" });
const FALLBACK_COLOR = "var(--primary)";

/**
 * A slim strip above the week calendar with only this week's interviews (from Interview Prep).
 * On wide screens it uses the calendar's own column template so each day sits over its column.
 */
export function InterviewTimeline({ agenda, cols }: { agenda: WeekAgenda; cols: string }) {
  const color = agenda.prep?.color ?? FALLBACK_COLOR;
  const href = agenda.prep ? `/g/${agenda.prep.slug}` : null;
  const byDay = new Map(agenda.days.map((d) => [d.date, agenda.interviews.filter((i) => i.date === d.date)]));
  const count = agenda.interviews.length;

  return (
    <section aria-labelledby="interviews-heading" className="overflow-hidden rounded-xl border bg-card">
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <Briefcase className="size-3.5 text-muted-foreground" />
        <h2 id="interviews-heading" className="font-sans text-sm font-medium">
          Interviews
        </h2>
        <span className="text-xs text-muted-foreground">{count === 0 ? "none this week" : `${count} this week`}</span>
        {href && (
          <Link href={href} className="ml-auto text-xs text-primary hover:underline">
            {count === 0 ? "Add in Interview Prep" : "Interview Prep"}
          </Link>
        )}
      </div>

      {/* Wide: one cell per day, aligned with the calendar's day columns. */}
      <div className={cn(cols, "hidden min-h-12 @4xl:grid")}>
        <div />
        {agenda.days.map((d) => (
          <ul key={d.date} className={cn("min-w-0 space-y-1 border-l p-1", d.date === agenda.today && "bg-primary/[0.03]")} aria-label={fmtDay(d.date, { weekday: "long", month: "short", day: "numeric" })}>
            {byDay.get(d.date)!.map((iv) => (
              <li key={iv.id}>
                <InterviewChip iv={iv} color={color} href={href} tz={agenda.tz} past={iv.at < agenda.generatedAt} />
              </li>
            ))}
          </ul>
        ))}
      </div>

      {/* Narrow: the week's interviews as a short list. */}
      <div className="@4xl:hidden">
        {count === 0 ? (
          <p className="px-4 py-2 text-xs text-muted-foreground">No interviews this week.</p>
        ) : (
          <ul className="divide-y">
            {agenda.interviews.map((iv) => (
              <li key={iv.id} className="flex items-center gap-3 px-4 py-1.5 text-xs">
                <span className={cn("w-16 shrink-0", iv.date === agenda.today ? "font-medium text-primary" : "text-muted-foreground")}>
                  {iv.date === agenda.today ? "Today" : `${fmtDay(iv.date, { weekday: "short" })} ${Number(iv.date.slice(8))}`}
                </span>
                <InterviewChip iv={iv} color={color} href={href} tz={agenda.tz} past={iv.at < agenda.generatedAt} inline />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function InterviewChip({ iv, color, href, tz, past, inline = false }: { iv: AgendaInterview; color: string; href: string | null; tz: string; past: boolean; inline?: boolean }) {
  const title = iv.companyName ?? "Interview";
  const tooltip = [`${title}${iv.role ? ` – ${iv.role}` : ""}`, formatTime(iv.at, tz), iv.stage].filter(Boolean).join("\n");
  const body = (
    <>
      <span className="shrink-0 font-medium tabular-nums">{formatTime(iv.at, tz)}</span>
      <span className="min-w-0 truncate">
        {title}
        {iv.role && <span className="text-muted-foreground"> · {iv.role}</span>}
      </span>
    </>
  );
  const className = cn(
    "flex min-w-0 items-baseline gap-1.5 rounded-md px-1.5 py-0.5 text-xs hover:brightness-110",
    inline ? "flex-1" : "w-full",
    past && "opacity-55",
  );
  const style = { backgroundColor: `color-mix(in oklab, ${color} 16%, transparent)`, borderLeft: `3px solid ${color}` };
  return href ? (
    <Link href={href} className={className} style={style} title={tooltip}>
      {body}
    </Link>
  ) : (
    <span className={className} style={style} title={tooltip}>
      {body}
    </span>
  );
}
