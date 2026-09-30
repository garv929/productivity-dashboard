import "server-only";
import { tool } from "ai";
import { z } from "zod";
import { listCompletedTasks, listOpenTasks } from "@/lib/todoist";
import { groupForTask, tasksByGroup } from "@/lib/domain/group-mapping";
import { countTasks, isDueToday, isOverdue, rankNextSteps } from "@/lib/domain/next-step";
import { addDays, dayRange, localDate, weekRange } from "@/lib/domain/time";
import { fail, isoDate, nextStepCtx, taskView, untrusted, type ToolCtx } from "../context";

export function taskReadTools(tc: ToolCtx) {
  return {
    list_groups: tool({
      description:
        "List the active dashboard groups (Applications, Networking, Interview Prep, …) with open/overdue/due-today counts and each group's current next step. Start here when you need group slugs.",
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const [groups, tasks] = await Promise.all([tc.groups(), listOpenTasks()]);
          const active = groups.filter((g) => !g.archivedAt);
          const byGroup = tasksByGroup(tasks, active);
          const ctx = nextStepCtx(tc);
          return untrusted(
            active.map((g) => {
              const list = byGroup.get(g.id) ?? [];
              const next = rankNextSteps(list, ctx)[0];
              return {
                slug: g.slug,
                name: g.name,
                kind: g.kind,
                mappedToTodoist: Boolean(g.todoistProjectId),
                ...countTasks(list, ctx),
                nextStep: next ? taskView(next, groups, tc) : null,
              };
            }),
          );
        } catch (err) {
          return fail(err);
        }
      },
    }),

    get_tasks: tool({
      description:
        "Get Todoist tasks. Filter by group slug, status (open/completed), due range, overdue/due-today, label or text. Completed tasks need a date range (defaults to this week, max 31 days). scope='account' also includes tasks outside dashboard groups; those are READ-ONLY.",
      inputSchema: z.object({
        group: z.string().optional().describe("Group slug; omit for all groups"),
        scope: z.enum(["groups", "account"]).default("groups"),
        status: z.enum(["open", "completed"]).default("open"),
        dueFrom: z.string().regex(isoDate).optional().describe("YYYY-MM-DD inclusive"),
        dueTo: z.string().regex(isoDate).optional().describe("YYYY-MM-DD inclusive"),
        overdueOnly: z.boolean().optional(),
        dueTodayOnly: z.boolean().optional(),
        includeUndated: z.boolean().optional().describe("With dueFrom/dueTo, also include tasks without a date"),
        label: z.string().optional(),
        query: z.string().optional().describe("Case-insensitive text match on title/description"),
        completedFrom: z.string().regex(isoDate).optional(),
        completedTo: z.string().regex(isoDate).optional(),
        limit: z.number().int().min(1).max(100).default(40),
      }),
      execute: async (input) => {
        try {
          const groups = await tc.groups();
          const active = groups.filter((g) => !g.archivedAt);
          const ctx = nextStepCtx(tc);
          let tasks;
          if (input.status === "completed") {
            const week = weekRange(tc.now, tc.tz);
            const from = input.completedFrom ?? week.weekStart;
            const to = input.completedTo ?? localDate(tc.now, tc.tz);
            if (to < from) return { error: "completedTo is before completedFrom." };
            if (new Date(to).getTime() - new Date(from).getTime() > 31 * 86_400_000) return { error: "Completed-task range is limited to 31 days." };
            tasks = await listCompletedTasks(dayRange(from, tc.tz).start.toISOString(), dayRange(addDays(to, 0), tc.tz).end.toISOString());
          } else {
            tasks = await listOpenTasks();
          }
          if (input.group) {
            const g = active.find((x) => x.slug === input.group);
            if (!g) return { error: `No active group "${input.group}". Call list_groups for valid slugs.` };
            tasks = tasks.filter((t) => groupForTask(t, active)?.id === g.id);
          } else if (input.scope === "groups") {
            tasks = tasks.filter((t) => groupForTask(t, active));
          }
          if (input.overdueOnly) tasks = tasks.filter((t) => isOverdue(t, ctx));
          if (input.dueTodayOnly) tasks = tasks.filter((t) => isDueToday(t, ctx));
          if (input.dueFrom || input.dueTo) {
            tasks = tasks.filter((t) =>
              !t.due ? Boolean(input.includeUndated) : (!input.dueFrom || t.due.date >= input.dueFrom) && (!input.dueTo || t.due.date <= input.dueTo),
            );
          }
          if (input.label) tasks = tasks.filter((t) => t.labels.includes(input.label!));
          if (input.query) {
            const q = input.query.toLowerCase();
            tasks = tasks.filter((t) => t.content.toLowerCase().includes(q) || t.description.toLowerCase().includes(q));
          }
          const ranked = input.status === "open" ? [...tasks].sort((a, b) => (a.due?.date ?? "9999").localeCompare(b.due?.date ?? "9999")) : tasks;
          return untrusted({
            total: ranked.length,
            truncated: ranked.length > input.limit,
            tasks: ranked.slice(0, input.limit).map((t) => taskView(t, groups, tc)),
          });
        } catch (err) {
          return fail(err);
        }
      },
    }),

    get_next_step: tool({
      description:
        "The next step (plus up to 2 alternatives) for one group, or for every active group. Uses the dashboard's ranking: `next` label, overdue, due today, priority, due date, Todoist order.",
      inputSchema: z.object({ group: z.string().optional().describe("Group slug; omit for all groups") }),
      execute: async ({ group }) => {
        try {
          const [groups, tasks] = await Promise.all([tc.groups(), listOpenTasks()]);
          const active = groups.filter((g) => !g.archivedAt);
          const targets = group ? active.filter((g) => g.slug === group) : active;
          if (group && targets.length === 0) return { error: `No active group "${group}".` };
          const byGroup = tasksByGroup(tasks, active);
          const ctx = nextStepCtx(tc);
          return untrusted(
            targets.map((g) => {
              const ranked = rankNextSteps(byGroup.get(g.id) ?? [], ctx);
              return {
                group: g.slug,
                groupName: g.name,
                nextStep: ranked[0] ? taskView(ranked[0], groups, tc) : null,
                alternatives: ranked.slice(1, 3).map((t) => taskView(t, groups, tc)),
                ...countTasks(byGroup.get(g.id) ?? [], ctx),
              };
            }),
          );
        } catch (err) {
          return fail(err);
        }
      },
    }),
  };
}
