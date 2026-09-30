"use client";

import Link from "next/link";
import useSWR from "swr";
import { AlertTriangle, ArrowRight, CalendarClock, CalendarX2, CircleDot, Clock } from "lucide-react";
import type { Overview, GroupCard } from "@/lib/services/dashboard";
import { GroupIcon } from "@/components/group-icon";
import { EmptyState } from "@/components/states";
import { formatDue, formatTime, greeting } from "@/lib/client/format";
import { useAssistant } from "@/components/chat/assistant-context";
import { cn } from "@/lib/utils";

export function HomeView({ initial }: { initial: Overview }) {
  const { data } = useSWR<Overview>("/api/overview", { fallbackData: initial });
  const o = data ?? initial;
  const highlighted = o.now?.event.groupId ?? null;
  const dateLabel = new Date(o.generatedAt).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: o.tz });

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-muted-foreground">{dateLabel}</p>
        <h1 className="mt-1 text-3xl sm:text-4xl">{greeting(new Date(o.generatedAt))}.</h1>
      </div>

      <NowBanner overview={o} />
      <TodayStrip overview={o} />

      {o.warnings.length > 0 && (
        <section aria-labelledby="warnings" className="rounded-xl border border-warning/25 bg-warning/5 p-4">
          <h2 id="warnings" className="mb-2 flex items-center gap-2 font-sans text-sm font-medium text-warning">
            <AlertTriangle className="size-4" /> Needs attention
          </h2>
          <ul className="space-y-1.5">
            {o.warnings.map((w) => (
              <li key={w.id}>
                <Link href={w.href} className="group flex items-start gap-2 text-sm hover:text-foreground">
                  <CircleDot className={cn("mt-0.5 size-3.5 shrink-0", w.severity === "warn" ? "text-warning" : "text-muted-foreground")} />
                  <span className="text-foreground/90 group-hover:underline">{w.message}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {o.cards.length === 0 ? (
        <EmptyState title="No groups yet">
          Run <code className="rounded bg-muted px-1">pnpm seed</code> to create your default groups and Todoist sections, or add one in{" "}
          <Link className="text-primary underline" href="/settings">Settings</Link>.
        </EmptyState>
      ) : (
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {o.cards.map((c, i) => (
            <GroupCardView key={c.id} card={c} index={i} today={o.today} highlighted={c.id === highlighted} />
          ))}
        </section>
      )}
    </div>
  );
}

function NowBanner({ overview: o }: { overview: Overview }) {
  const { ask } = useAssistant();
  if (o.calendarStatus === "needs-login") {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-surface px-4 py-3 text-sm">
        <CalendarX2 className="size-4 text-muted-foreground" />
        <span>Google Calendar needs to be re-connected.</span>
        <Link href="/settings" className="ml-auto text-primary underline-offset-2 hover:underline">Re-connect</Link>
      </div>
    );
  }
  if (!o.now) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-surface px-4 py-3 text-sm text-muted-foreground">
        <Clock className="size-4" />
        <span>No calendar block right now.</span>
        <button onClick={() => ask("What should I work on right now?")} className="ml-auto text-primary hover:underline">
          What should I work on?
        </button>
      </div>
    );
  }
  const { event, untilLabel, isWeeklyReview } = o.now;
  const body = (
    <>
      <span className="text-muted-foreground">Now:</span>{" "}
      <span className="font-medium">{event.groupName ?? event.title}</span>{" "}
      <span className="text-muted-foreground">until {untilLabel}</span>
    </>
  );
  return (
    <div
      className="flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3"
      style={event.color ? { borderColor: `${event.color}55`, backgroundColor: `${event.color}12` } : undefined}
    >
      <span className="relative flex size-2.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ backgroundColor: event.color ?? "var(--primary)" }} />
        <span className="relative inline-flex size-2.5 rounded-full" style={{ backgroundColor: event.color ?? "var(--primary)" }} />
      </span>
      {isWeeklyReview ? (
        <Link href="/scorecard" className="hover:underline">{body} → Weekly review</Link>
      ) : event.groupSlug ? (
        <Link href={`/g/${event.groupSlug}`} className="hover:underline">{body}</Link>
      ) : (
        <span>{body}</span>
      )}
      {event.groupSlug && (
        <button onClick={() => ask("What should I work on in this block?")} className="ml-auto text-sm text-primary hover:underline">
          What should I do in this block?
        </button>
      )}
    </div>
  );
}

function TodayStrip({ overview: o }: { overview: Overview }) {
  if (o.calendarStatus !== "ok") return null;
  if (o.todayEvents.length === 0) return null;
  const nowMs = new Date(o.generatedAt).getTime();
  return (
    <section aria-label="Today's calendar">
      <h2 className="mb-2 font-sans text-xs font-medium tracking-wide text-muted-foreground uppercase">Today</h2>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
        {o.todayEvents.map((e) => {
          const past = new Date(e.end).getTime() < nowMs;
          const current = !past && new Date(e.start).getTime() <= nowMs;
          const chip = (
            <div
              className={cn(
                "flex min-w-40 shrink-0 flex-col rounded-lg border-l-[3px] bg-card px-3 py-2 ring-1 ring-border",
                past && "opacity-50",
                current && "ring-2 ring-primary/40",
              )}
              style={{ borderLeftColor: e.color ?? "var(--muted-foreground)" }}
            >
              <span className="text-xs text-muted-foreground">
                {e.allDay ? "All day" : `${formatTime(e.start, o.tz)}–${formatTime(e.end, o.tz)}`}
              </span>
              <span className="truncate text-sm">{e.title}</span>
            </div>
          );
          if (e.isWeeklyReview) return <Link key={e.id} href="/scorecard">{chip}</Link>;
          if (e.groupSlug) return <Link key={e.id} href={`/g/${e.groupSlug}`}>{chip}</Link>;
          return <div key={e.id}>{chip}</div>;
        })}
      </div>
    </section>
  );
}

function GroupCardView({ card: c, index, today, highlighted }: { card: GroupCard; index: number; today: string; highlighted: boolean }) {
  const due = c.nextStep ? formatDue(c.nextStep, today) : null;
  return (
    <Link
      href={`/g/${c.slug}`}
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-xl border bg-card p-4 pl-5 transition-all hover:-translate-y-0.5 hover:shadow-md hover:shadow-black/5",
        highlighted && "ring-2",
      )}
      style={highlighted ? ({ "--tw-ring-color": c.color } as React.CSSProperties) : undefined}
    >
      <span aria-hidden className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: c.color }} />
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <GroupIcon name={c.icon} className="size-4" />
        <span className="font-medium text-foreground">{c.name}</span>
        {highlighted && (
          <span className="rounded-full px-2 py-0.5 text-[11px] font-medium text-white" style={{ backgroundColor: c.color }}>
            Now
          </span>
        )}
        <kbd className="ml-auto text-[10px] text-muted-foreground/60 max-sm:hidden">g {index + 1}</kbd>
      </div>

      <div className="mt-3 min-h-14 flex-1">
        <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Next step</p>
        {c.nextStep ? (
          <p className="mt-1 font-serif text-[17px] leading-snug">{c.nextStep.content}</p>
        ) : (
          <p className="mt-1 font-serif text-[17px] text-muted-foreground italic">
            {c.mapped ? "Nothing open. Nice." : "Not mapped to Todoist yet"}
          </p>
        )}
        {due && (
          <p className={cn("mt-1 text-xs", due.tone === "overdue" ? "text-destructive" : "text-muted-foreground")}>
            {due.tone === "overdue" ? "Overdue · " : ""}
            {due.label}
          </p>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>{c.counts.open} open</span>
        {c.counts.overdue > 0 && <span className="text-destructive">{c.counts.overdue} overdue</span>}
        {c.counts.dueToday > 0 && <span className="text-foreground">{c.counts.dueToday} today</span>}
        <ArrowRight className="ml-auto size-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
      </div>
      <div className="mt-2 flex items-center gap-1.5 border-t pt-2 text-xs text-muted-foreground">
        <CalendarClock className="size-3.5" />
        {c.nextBlock ? <span>{c.nextBlock.label}</span> : <span>No upcoming block</span>}
      </div>
    </Link>
  );
}
