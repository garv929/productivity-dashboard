import "server-only";
import { env } from "@/lib/env";
import { listActiveGroups } from "@/lib/domain/groups";
import { localDate, weekRangeFromStart, type LocalDate } from "@/lib/domain/time";
import { listInterviews } from "./prep";

/** An interview from Interview Prep, placed on its local day for the homepage timeline. */
export type AgendaInterview = {
  id: string;
  date: LocalDate;
  /** ISO instant. */
  at: string;
  companyName: string | null;
  role: string | null;
  stage: string | null;
};

export type InterviewWeek = {
  generatedAt: string;
  tz: string;
  today: LocalDate;
  weekStart: LocalDate;
  weekEnd: LocalDate;
  days: LocalDate[];
  /** That week's interviews, soonest first. */
  interviews: AgendaInterview[];
  /** The Interview Prep page (link + colour for the timeline), if that group exists. */
  prep: { slug: string; color: string } | null;
};

/** Monday–Sunday interviews for the homepage timeline, independent of the calendar's week. */
export async function getInterviewWeek(userId: string, weekOf?: LocalDate, now = new Date()): Promise<InterviewWeek> {
  const tz = env.APP_TIMEZONE;
  const today = localDate(now, tz);
  const week = weekRangeFromStart(weekOf ?? today, tz);
  const [groups, rows] = await Promise.all([listActiveGroups(userId), listInterviews(userId, { from: week.start, to: week.end })]);
  const prep = groups.find((g) => g.kind === "prep");
  return {
    generatedAt: now.toISOString(),
    tz,
    today,
    weekStart: week.weekStart,
    weekEnd: week.weekEnd,
    days: week.days,
    interviews: rows.map((i) => ({
      id: i.id,
      date: localDate(i.scheduledAt, tz),
      at: i.scheduledAt.toISOString(),
      companyName: i.companyName,
      role: i.role,
      stage: i.stage,
    })),
    prep: prep ? { slug: prep.slug, color: prep.color } : null,
  };
}
