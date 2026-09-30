import "server-only";
import type { GroupKind } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { weekRange } from "@/lib/domain/time";
import { listActivity } from "./activity";
import { listApplications } from "./applications";
import { listContacts } from "./contacts";
import { listCompanies } from "./companies";
import { listInterviews, listQuestions, listStories } from "./prep";
import { listIncomeOptions } from "./income";
import { listFocusItems } from "./focus";
import { getTargets } from "./targets";
import { DEFAULT_SIDE_INCOME_CAP } from "@/lib/domain/scorecard";

async function weekCounts(userId: string, now: Date) {
  const week = weekRange(now, env.APP_TIMEZONE);
  const [activity, targets] = await Promise.all([listActivity(userId, week.start, week.end), getTargets(userId, week.weekStart)]);
  const sumOf = (type: string) => activity.filter((a) => a.type === type).reduce((s, a) => s + Number(a.value), 0);
  return { week, targets, sumOf };
}

export async function loadPanel(userId: string, kind: GroupKind, now = new Date()) {
  switch (kind) {
    case "pipeline": {
      const [apps, companies, w] = await Promise.all([listApplications(userId), listCompanies(userId), weekCounts(userId, now)]);
      return {
        kind,
        applications: apps,
        companies: companies.map((c) => ({ id: c.id, name: c.name })),
        weekly: { actual: w.sumOf("application"), target: w.targets.applications.min },
      } as const;
    }
    case "people": {
      const [contacts, w] = await Promise.all([listContacts(userId, { now }), weekCounts(userId, now)]);
      return {
        kind,
        contacts,
        weekly: {
          outreach: { actual: w.sumOf("outreach"), min: w.targets.outreach.min, max: w.targets.outreach.max },
          followUps: { actual: w.sumOf("follow_up"), min: w.targets.follow_ups.min, max: w.targets.follow_ups.max },
          conversations: { actual: w.sumOf("conversation"), min: w.targets.conversations.min, max: w.targets.conversations.max },
        },
      } as const;
    }
    case "prep": {
      const [interviews, questions, stories, apps, w] = await Promise.all([
        listInterviews(userId, { upcomingOnly: true, now }),
        listQuestions(userId),
        listStories(userId),
        listApplications(userId),
        weekCounts(userId, now),
      ]);
      return {
        kind,
        interviews,
        questions,
        stories,
        applications: apps.map((a) => ({ id: a.id, label: `${a.companyName} – ${a.role}` })),
        weekly: { actual: w.sumOf("prep_session"), target: w.targets.prep_sessions.min },
      } as const;
    }
    case "research": {
      return { kind, companies: await listCompanies(userId) } as const;
    }
    case "options": {
      const [options, w] = await Promise.all([listIncomeOptions(userId), weekCounts(userId, now)]);
      return {
        kind,
        options,
        hours: { logged: w.sumOf("side_income_hours"), cap: w.targets.side_income_hours.max ?? DEFAULT_SIDE_INCOME_CAP },
      } as const;
    }
    case "focus": {
      return { kind, items: await listFocusItems(userId) } as const;
    }
    case "plain":
      return { kind } as const;
  }
}

export type PanelData = Awaited<ReturnType<typeof loadPanel>>;
