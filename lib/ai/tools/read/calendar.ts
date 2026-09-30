import "server-only";
import { tool } from "ai";
import { z } from "zod";
import { getCalendarEvents, tagEvents } from "@/lib/calendar";
import { addDays, dayRange, localDate } from "@/lib/domain/time";
import { fail, fmtInstant, isoDate, untrusted, type ToolCtx } from "../context";

export function calendarReadTools(tc: ToolCtx) {
  const view = (e: ReturnType<typeof tagEvents>[number]) => ({
    title: e.title,
    start: e.allDay ? localDate(new Date(e.start), tc.tz) : fmtInstant(e.start, tc.tz, "yyyy-MM-dd HH:mm"),
    end: e.allDay ? null : fmtInstant(e.end, tc.tz, "yyyy-MM-dd HH:mm"),
    allDay: e.allDay,
    group: e.groupSlug,
    groupName: e.groupName,
  });

  return {
    get_calendar_blocks: tool({
      description:
        "Google Calendar events (read-only) between two dates, each tagged with the group whose calendar rules match its title (or null). Max 14 days. Use it to find a group's upcoming blocks when rescheduling.",
      inputSchema: z.object({
        from: z.string().regex(isoDate).optional().describe("YYYY-MM-DD, default today"),
        to: z.string().regex(isoDate).optional().describe("YYYY-MM-DD inclusive, default = from"),
      }),
      execute: async ({ from, to }) => {
        try {
          const start = from ?? localDate(tc.now, tc.tz);
          const end = to ?? start;
          if (end < start) return { error: "`to` is before `from`." };
          if (new Date(end).getTime() - new Date(start).getTime() > 14 * 86_400_000) return { error: "Range is limited to 14 days." };
          const [groups, res] = await Promise.all([
            tc.groups(),
            getCalendarEvents(tc.userId, dayRange(start, tc.tz).start, dayRange(addDays(end, 0), tc.tz).end),
          ]);
          if (res.status === "needs-login") return { status: "needs-login", message: "Google Calendar access expired. The user needs to re-connect Google in Settings." };
          if (res.status === "error") return { status: "error", message: res.message ?? "Couldn't reach Google Calendar." };
          return untrusted({ status: "ok", timezone: tc.tz, events: tagEvents(res.events, groups).map(view) });
        } catch (err) {
          return fail(err);
        }
      },
    }),

    get_current_block: tool({
      description: "The calendar event happening right now (if any), its matched group and minutes remaining, plus the next event today.",
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const today = localDate(tc.now, tc.tz);
          const [groups, res] = await Promise.all([tc.groups(), getCalendarEvents(tc.userId, dayRange(today, tc.tz).start, dayRange(today, tc.tz).end)]);
          if (res.status === "needs-login") return { status: "needs-login", message: "Google Calendar access expired; re-connect in Settings." };
          if (res.status === "error") return { status: "error", message: res.message ?? "Couldn't reach Google Calendar." };
          const t = tc.now.getTime();
          const events = tagEvents(res.events, groups).filter((e) => !e.allDay);
          const current = events
            .filter((e) => new Date(e.start).getTime() <= t && new Date(e.end).getTime() > t)
            .sort((a, b) => Number(Boolean(b.groupId)) - Number(Boolean(a.groupId)))[0];
          const next = events.filter((e) => new Date(e.start).getTime() > t).sort((a, b) => a.start.localeCompare(b.start))[0];
          return untrusted({
            status: "ok",
            now: fmtInstant(tc.now, tc.tz, "EEE yyyy-MM-dd HH:mm"),
            current: current ? { ...view(current), minutesRemaining: Math.round((new Date(current.end).getTime() - t) / 60_000) } : null,
            next: next ? { ...view(next), startsInMinutes: Math.round((new Date(next.start).getTime() - t) / 60_000) } : null,
          });
        } catch (err) {
          return fail(err);
        }
      },
    }),
  };
}
