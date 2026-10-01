import "server-only";
import { google } from "googleapis";
import { and, eq } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import { db } from "@/lib/db";
import { accounts, type Group } from "@/lib/db/schema";
import { decrypt, encrypt } from "@/lib/crypto";
import { env } from "@/lib/env";
import { matchEventToGroup } from "@/lib/domain/calendar-match";
import { startOfLocalDay } from "@/lib/domain/time";
import { GoogleAuthError } from "@/lib/errors";
import { htmlToText } from "@/lib/domain/text";

export const CALENDAR_TAG = "calendar";

export type CalendarEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  /** Plain-text description from Google Calendar (HTML converted), if any. */
  description: string | null;
};

export type TaggedEvent = CalendarEvent & {
  groupId: string | null;
  groupSlug: string | null;
  groupName: string | null;
  color: string | null;
};

export type CalendarStatus = "ok" | "needs-login" | "error";

export type CalendarResult = { status: CalendarStatus; events: CalendarEvent[]; message?: string };

async function oauthClientFor(userId: string) {
  const [account] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.provider, "google")))
    .limit(1);
  if (!account?.refresh_token) throw new GoogleAuthError();

  const client = new google.auth.OAuth2(env.AUTH_GOOGLE_ID, env.AUTH_GOOGLE_SECRET);
  client.setCredentials({
    refresh_token: decrypt(account.refresh_token),
    access_token: account.access_token ? decrypt(account.access_token) : undefined,
    expiry_date: account.expires_at ? account.expires_at * 1000 : undefined,
  });

  client.on("tokens", (tokens) => {
    const patch: Partial<typeof accounts.$inferInsert> = {};
    if (tokens.access_token) patch.access_token = encrypt(tokens.access_token);
    if (tokens.expiry_date) patch.expires_at = Math.floor(tokens.expiry_date / 1000);
    if (tokens.refresh_token) patch.refresh_token = encrypt(tokens.refresh_token);
    if (Object.keys(patch).length === 0) return;
    void db
      .update(accounts)
      .set(patch)
      .where(and(eq(accounts.provider, "google"), eq(accounts.providerAccountId, account.providerAccountId)))
      .catch((err) => console.error("Failed to persist refreshed Google token", err));
  });
  return client;
}

function isAuthFailure(err: unknown): boolean {
  const e = err as { response?: { status?: number; data?: { error?: string } }; message?: string; code?: number | string };
  const msg = `${e?.message ?? ""} ${e?.response?.data?.error ?? ""}`;
  return (
    err instanceof GoogleAuthError ||
    e?.response?.status === 401 ||
    e?.code === 401 ||
    /invalid_grant|invalid_token|unauthorized_client|No refresh token/i.test(msg)
  );
}

async function fetchEvents(userId: string, timeMin: string, timeMax: string, calendarId = env.GOOGLE_CALENDAR_ID): Promise<CalendarResult> {
  try {
    const auth = await oauthClientFor(userId);
    const calendar = google.calendar({ version: "v3", auth });
    const events: CalendarEvent[] = [];
    let pageToken: string | undefined;
    do {
      const res = await calendar.events.list({
        calendarId,
        timeMin,
        timeMax,
        singleEvents: true,
        orderBy: "startTime",
        maxResults: 250,
        pageToken,
      });
      for (const ev of res.data.items ?? []) {
        if (ev.status === "cancelled" || !ev.id) continue;
        const allDay = Boolean(ev.start?.date && !ev.start?.dateTime);
        const toIso = (p?: { dateTime?: string | null; date?: string | null }) =>
          p?.dateTime
            ? new Date(p.dateTime).toISOString()
            : p?.date
              ? startOfLocalDay(p.date, env.APP_TIMEZONE).toISOString()
              : null;
        const start = toIso(ev.start);
        const end = toIso(ev.end);
        if (!start || !end) continue;
        events.push({ id: ev.id, title: ev.summary ?? "(untitled)", start, end, allDay, description: htmlToText(ev.description) });
      }
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);
    return { status: "ok", events };
  } catch (err) {
    if (isAuthFailure(err)) {
      return { status: "needs-login", events: [], message: "Google Calendar needs to be re-connected." };
    }
    console.error("Google Calendar error", err);
    return { status: "error", events: [], message: "Couldn't reach Google Calendar right now." };
  }
}

const cachedEvents = unstable_cache(fetchEvents, ["calendar:events"], {
  tags: [CALENDAR_TAG],
  revalidate: 300,
});

/** Events in [from, to). Cached 5 minutes under the `calendar` tag. Never throws. */
export async function getCalendarEvents(userId: string, from: Date, to: Date): Promise<CalendarResult> {
  const round = (d: Date) => new Date(Math.floor(d.getTime() / 60_000) * 60_000).toISOString();
  // calendarId is part of the cache key so changing GOOGLE_CALENDAR_ID takes effect immediately.
  return cachedEvents(userId, round(from), round(to), env.GOOGLE_CALENDAR_ID);
}

export function tagEvents(events: CalendarEvent[], groups: Group[]): TaggedEvent[] {
  return events.map((ev) => {
    const g = matchEventToGroup(ev.title, groups);
    return {
      ...ev,
      groupId: g?.id ?? null,
      groupSlug: g?.slug ?? null,
      groupName: g?.name ?? null,
      color: g?.color ?? null,
    };
  });
}

export async function googleConnectionStatus(userId: string): Promise<CalendarStatus> {
  const now = new Date();
  const res = await fetchEvents(userId, now.toISOString(), new Date(now.getTime() + 60_000).toISOString());
  return res.status;
}
