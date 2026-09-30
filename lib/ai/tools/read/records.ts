import "server-only";
import { tool } from "ai";
import { z } from "zod";
import { applicationStage, companyStatus, incomeStatus } from "@/lib/db/schema";
import { listApplications } from "@/lib/services/applications";
import { listContacts } from "@/lib/services/contacts";
import { listCompanies } from "@/lib/services/companies";
import { listInterviews, listQuestions, listStories } from "@/lib/services/prep";
import { listIncomeOptions, sideIncomeHoursThisWeek } from "@/lib/services/income";
import { FOCUS_ACTIVE_LIMIT, listFocusItems } from "@/lib/services/focus";
import { getScorecard } from "@/lib/services/dashboard";
import { biggestGap } from "@/lib/domain/scorecard";
import { dayRange, localDate, mondayOf } from "@/lib/domain/time";
import { fail, fmtInstant, isoDate, serviceCtx, untrusted, type ToolCtx } from "../context";

const day = (d: Date | null | undefined, tz: string) => (d ? localDate(d, tz) : null);

export function recordReadTools(tc: ToolCtx) {
  const tz = tc.tz;
  const daysSince = (d: Date | null) => (d ? Math.floor((tc.now.getTime() - d.getTime()) / 86_400_000) : null);

  return {
    get_applications: tool({
      description:
        "Application pipeline rows. Filter by stage, company/role text, or applied date range. `daysSinceApplied` helps find Applied 7+ days with no follow-up.",
      inputSchema: z.object({
        stage: z.enum(applicationStage.enumValues).optional(),
        company: z.string().optional(),
        appliedFrom: z.string().regex(isoDate).optional(),
        appliedTo: z.string().regex(isoDate).optional(),
      }),
      execute: async (f) => {
        try {
          const rows = await listApplications(tc.userId, {
            stage: f.stage,
            company: f.company,
            appliedFrom: f.appliedFrom ? dayRange(f.appliedFrom, tz).start : undefined,
            appliedTo: f.appliedTo ? dayRange(f.appliedTo, tz).end : undefined,
          });
          return untrusted(
            rows.map((a) => ({
              id: a.id,
              company: a.companyName,
              role: a.role,
              stage: a.stage,
              url: a.url,
              appliedOn: day(a.appliedAt, tz),
              daysSinceApplied: daysSince(a.appliedAt),
              nextFollowUp: day(a.nextFollowUpAt, tz),
              notes: a.notes?.slice(0, 400) ?? null,
            })),
          );
        } catch (err) {
          return fail(err);
        }
      },
    }),

    get_contacts: tool({
      description: "Contacts (networking). Filter by overdue check-in, company or name. Overdue ones come first.",
      inputSchema: z.object({ overdueOnly: z.boolean().optional(), company: z.string().optional(), name: z.string().optional() }),
      execute: async (f) => {
        try {
          const rows = await listContacts(tc.userId, { ...f, now: tc.now });
          return untrusted(
            rows.map((c) => ({
              id: c.id,
              name: c.name,
              company: c.company,
              relationship: c.relationship,
              channel: c.channel,
              lastContact: day(c.lastContactAt, tz),
              nextCheckIn: day(c.nextCheckInAt, tz),
              checkInOverdue: Boolean(c.nextCheckInAt && c.nextCheckInAt.getTime() < tc.now.getTime()),
              notes: c.notes?.slice(-400) ?? null,
            })),
          );
        } catch (err) {
          return fail(err);
        }
      },
    }),

    get_companies: tool({
      description: "Target companies (research). Filter by status.",
      inputSchema: z.object({ status: z.enum(companyStatus.enumValues).optional() }),
      execute: async ({ status }) => {
        try {
          const rows = await listCompanies(tc.userId, { status });
          return untrusted(
            rows.map((c) => ({
              id: c.id,
              name: c.name,
              status: c.status,
              why: c.why,
              rolesOfInterest: c.rolesOfInterest,
              hasLinkedTask: Boolean(c.todoistTaskId),
              notes: c.notes?.slice(0, 300) ?? null,
            })),
          );
        } catch (err) {
          return fail(err);
        }
      },
    }),

    get_interviews_and_prep: tool({
      description: "Upcoming interviews (with application), unpracticed prep questions, and the saved story versions (30s, interview, networking, follow-up Q&A).",
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const [interviews, questions, stories] = await Promise.all([
            listInterviews(tc.userId, { upcomingOnly: true, now: tc.now }),
            listQuestions(tc.userId, { unpracticedOnly: true }),
            listStories(tc.userId),
          ]);
          return untrusted({
            interviews: interviews.map((i) => ({
              id: i.id,
              applicationId: i.applicationId,
              company: i.companyName,
              role: i.role,
              when: fmtInstant(i.scheduledAt, tz, "EEE yyyy-MM-dd HH:mm"),
              date: localDate(i.scheduledAt, tz),
              stage: i.stage,
              interviewer: i.interviewer,
              prepNotes: i.prepNotes?.slice(0, 500) ?? null,
            })),
            unpracticedQuestions: questions.slice(0, 30).map((q) => ({ id: q.id, question: q.question, category: q.category })),
            stories: stories.map((s) => ({ kind: s.kind, body: s.bodyMd.slice(0, 2000) })),
          });
        } catch (err) {
          return fail(err);
        }
      },
    }),

    get_side_income_options: tool({
      description: "Side-income options with $/h, hours/week and status, plus hours logged this week vs. the weekly cap.",
      inputSchema: z.object({ status: z.enum(incomeStatus.enumValues).optional() }),
      execute: async ({ status }) => {
        try {
          const [options, hours] = await Promise.all([listIncomeOptions(tc.userId, { status }), sideIncomeHoursThisWeek(serviceCtx(tc))]);
          return untrusted({
            hoursThisWeek: hours.hours,
            weeklyCap: hours.cap,
            remaining: Math.max(0, Math.round((hours.cap - hours.hours) * 10) / 10),
            options: options.map((o) => ({
              id: o.id,
              name: o.name,
              type: o.type,
              expectedHourly: o.expectedHourly,
              hoursPerWeek: o.hoursPerWeek,
              status: o.status,
              verdict: o.verdictNotes,
            })),
          });
        } catch (err) {
          return fail(err);
        }
      },
    }),

    get_focus_items: tool({
      description: `Personal Development focus items and their status. At most ${FOCUS_ACTIVE_LIMIT} can be active at once.`,
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const items = await listFocusItems(tc.userId);
          return untrusted({
            activeLimit: FOCUS_ACTIVE_LIMIT,
            activeCount: items.filter((i) => i.status === "active").length,
            items: items.map((i) => ({ id: i.id, title: i.title, goal: i.goal, status: i.status, link: i.link })),
          });
        } catch (err) {
          return fail(err);
        }
      },
    }),

    get_scorecard: tool({
      description:
        "Weekly targets vs. actuals (applications, outreach, follow-ups, prep sessions, conversations, side-income hours) for a week (default: current). Includes the biggest gap and whether the weekly review is filled in.",
      inputSchema: z.object({ weekStart: z.string().regex(isoDate).optional().describe("Any date in the week; the Monday is used") }),
      execute: async ({ weekStart }) => {
        try {
          const sc = await getScorecard(tc.userId, weekStart ? mondayOf(weekStart) : undefined, tc.now);
          const gap = biggestGap(sc.rows);
          return {
            weekStart: sc.weekStart,
            weekEnd: sc.weekEnd,
            isCurrentWeek: sc.isCurrentWeek,
            daysLeftInWeek: sc.isCurrentWeek ? 7 - ((new Date(`${localDate(tc.now, tz)}T12:00:00Z`).getUTCDay() + 6) % 7) - 1 : 0,
            metrics: sc.rows.map((r) => ({ metric: r.metric, label: r.label, actual: r.actual, min: r.min, max: r.max, isCap: r.isCap, status: r.status, groupKind: r.groupKind })),
            biggestGap: gap ? { metric: gap.metric, label: gap.label, actual: gap.actual, min: gap.min, groupKind: gap.groupKind } : null,
            groupsByKind: Object.fromEntries(sc.chartGroups.map((g) => [g.kind, g.slug])),
            weeklyReviewSaved: Boolean(sc.review),
          };
        } catch (err) {
          return fail(err);
        }
      },
    }),
  };
}
