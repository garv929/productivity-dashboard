import type { TaskLite } from "@/lib/todoist/types";
import { isDueToday, isOverdue, type NextStepContext } from "./next-step";

export type Warning = {
  id: string;
  kind: "stale_group" | "contact_overdue" | "application_no_follow_up" | "overdue_pileup" | "overload";
  message: string;
  href: string;
  severity: "info" | "warn";
};

export type WarningGroup = { id: string; slug: string; name: string; createdAt: Date };

export type WarningInputs = {
  ctx: NextStepContext;
  groups: WarningGroup[];
  openTasksByGroup: Map<string, TaskLite[]>;
  /** Count of Todoist completions per group over the last 7 days. */
  completedLast7ByGroup: Map<string, number>;
  /** Count of activity_log rows per group over the last 7 days. */
  activityLast7ByGroup: Map<string, number>;
  contacts: { id: string; name: string; company: string | null; nextCheckInAt: Date | null }[];
  applications: {
    id: string;
    companyName: string;
    role: string;
    stage: string;
    appliedAt: Date | null;
    todoistTaskId: string | null;
  }[];
  /** Application ids with a follow_up activity logged since they were applied. */
  applicationsWithFollowUp: Set<string>;
  /** Minutes of calendar time per group today. */
  calendarMinutesTodayByGroup: Map<string, number>;
  networkingSlug?: string | null;
  applicationsSlug?: string | null;
};

const DAY_MS = 86_400_000;
const DEFAULT_TASK_MINUTES = 30;

export function taskMinutes(t: TaskLite): number {
  return t.durationMinutes ?? DEFAULT_TASK_MINUTES;
}

const FOLLOW_UP_RE = /follow[\s-]?up/i;

export function computeWarnings(input: WarningInputs): Warning[] {
  const { ctx, groups } = input;
  const out: Warning[] = [];
  const now = ctx.now.getTime();
  const allOpen = [...input.openTasksByGroup.values()].flat();

  for (const g of groups) {
    const completed = input.completedLast7ByGroup.get(g.id) ?? 0;
    const activity = input.activityLast7ByGroup.get(g.id) ?? 0;
    const oldEnough = now - g.createdAt.getTime() >= 7 * DAY_MS;
    if (oldEnough && completed === 0 && activity === 0) {
      out.push({
        id: `stale:${g.id}`,
        kind: "stale_group",
        message: `${g.name} has had no completed tasks or activity in 7 days.`,
        href: `/g/${g.slug}`,
        severity: "warn",
      });
    }

    const open = input.openTasksByGroup.get(g.id) ?? [];
    const overdue = open.filter((t) => isOverdue(t, ctx)).length;
    if (overdue >= 3) {
      out.push({
        id: `overdue:${g.id}`,
        kind: "overdue_pileup",
        message: `${g.name} has ${overdue} overdue tasks.`,
        href: `/g/${g.slug}`,
        severity: "warn",
      });
    }

    const dueToday = open.filter((t) => isDueToday(t, ctx) || (isOverdue(t, ctx) && t.due?.date === ctx.today));
    if (dueToday.length > 0) {
      const needed = dueToday.reduce((s, t) => s + taskMinutes(t), 0);
      const available = input.calendarMinutesTodayByGroup.get(g.id) ?? 0;
      if (needed > available) {
        out.push({
          id: `overload:${g.id}`,
          kind: "overload",
          message: `${g.name}: ${dueToday.length} task${dueToday.length === 1 ? "" : "s"} due today (~${fmtMin(needed)}) but only ${fmtMin(available)} of calendar time. Pick the top 3 rather than pushing the rest to tomorrow.`,
          href: `/g/${g.slug}`,
          severity: "info",
        });
      }
    }
  }

  const networkingHref = input.networkingSlug ? `/g/${input.networkingSlug}` : "/";
  for (const c of input.contacts) {
    if (c.nextCheckInAt && c.nextCheckInAt.getTime() < now) {
      out.push({
        id: `contact:${c.id}`,
        kind: "contact_overdue",
        message: `Check-in with ${c.name}${c.company ? ` (${c.company})` : ""} is overdue.`,
        href: networkingHref,
        severity: "warn",
      });
    }
  }

  const applicationsHref = input.applicationsSlug ? `/g/${input.applicationsSlug}` : "/";
  for (const a of input.applications) {
    if (a.stage !== "applied" || !a.appliedAt) continue;
    if (now - a.appliedAt.getTime() < 7 * DAY_MS) continue;
    if (input.applicationsWithFollowUp.has(a.id)) continue;
    const company = a.companyName.toLowerCase();
    const hasOpenFollowUp = allOpen.some(
      (t) =>
        (a.todoistTaskId && t.id === a.todoistTaskId) ||
        (FOLLOW_UP_RE.test(t.content) && t.content.toLowerCase().includes(company)),
    );
    if (hasOpenFollowUp) continue;
    const days = Math.floor((now - a.appliedAt.getTime()) / DAY_MS);
    out.push({
      id: `application:${a.id}`,
      kind: "application_no_follow_up",
      message: `${a.companyName} – ${a.role} has been in Applied for ${days} days with no follow-up.`,
      href: applicationsHref,
      severity: "warn",
    });
  }

  return out;
}

function fmtMin(m: number): string {
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}
