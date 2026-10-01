"use client";

import Link from "next/link";
import { ArrowRight, Clock } from "lucide-react";
import type { AgendaEventInput } from "@/lib/domain/agenda";
import { formatTime } from "@/lib/client/format";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const URL_RE = /(https?:\/\/[^\s<>()"]+[^\s<>()".,;:!?])/g;

/** Plain text with line breaks kept and http(s) URLs turned into links. */
export function LinkifiedText({ text, className }: { text: string; className?: string }) {
  const parts = text.split(URL_RE);
  return (
    <p className={cn("break-words whitespace-pre-line", className)}>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="text-primary underline-offset-2 hover:underline">
            {part.replace(/^https?:\/\/(www\.)?/, "").slice(0, 60)}
          </a>
        ) : (
          part
        ),
      )}
    </p>
  );
}

/** "Thu, Oct 1 · 9:30 AM – 11 AM" (or "All day") in the app timezone. */
export function eventWhen(e: Pick<AgendaEventInput, "start" | "end" | "allDay">, tz: string): string {
  const day = new Date(e.start).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: tz });
  return e.allDay ? `${day} · All day` : `${day} · ${formatTime(e.start, tz)} – ${formatTime(e.end, tz)}`;
}

/** Click an event to see its time, Google Calendar description and linked group. */
export function EventPopover({ event: e, tz, children }: { event: AgendaEventInput; tz: string; children: React.ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="start" className="w-80 gap-3 p-4">
        <div className="flex items-start gap-2.5">
          <span className="mt-1.5 size-2.5 shrink-0 rounded-full" style={{ backgroundColor: e.color ?? "var(--muted-foreground)" }} />
          <div className="min-w-0">
            <p className="font-medium leading-snug">{e.title}</p>
            <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="size-3" /> {eventWhen(e, tz)}
            </p>
          </div>
        </div>
        {e.description ? (
          <div className="max-h-56 overflow-y-auto rounded-md bg-surface px-3 py-2">
            <LinkifiedText text={e.description} className="text-xs leading-relaxed" />
          </div>
        ) : (
          <p className="text-xs text-muted-foreground italic">No description in Google Calendar.</p>
        )}
        {e.groupSlug && (
          <Link href={`/g/${e.groupSlug}`} className="flex items-center gap-1 text-xs text-primary hover:underline">
            Open {e.groupName ?? "group"} <ArrowRight className="size-3" />
          </Link>
        )}
      </PopoverContent>
    </Popover>
  );
}
