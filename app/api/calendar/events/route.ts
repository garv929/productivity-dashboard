import { z } from "zod";
import { withOwner } from "@/lib/auth-guard";
import { getCalendarEvents, tagEvents } from "@/lib/calendar";
import { listActiveGroups } from "@/lib/domain/groups";
import { dayRange, localDate, addDays } from "@/lib/domain/time";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

const query = z.object({ from: z.iso.date().optional(), to: z.iso.date().optional() });

export const GET = withOwner(async (req, owner) => {
  const params = query.parse(Object.fromEntries(new URL(req.url).searchParams));
  const today = localDate(new Date(), env.APP_TIMEZONE);
  const from = params.from ?? today;
  const to = params.to ?? addDays(from, 1);
  if (to < from) return Response.json({ error: "invalid", message: "`to` is before `from`" }, { status: 400 });
  const [res, groups] = await Promise.all([
    getCalendarEvents(owner.userId, dayRange(from, env.APP_TIMEZONE).start, dayRange(to, env.APP_TIMEZONE).start),
    listActiveGroups(owner.userId),
  ]);
  return Response.json({ status: res.status, message: res.message, events: tagEvents(res.events, groups) });
});
