import "server-only";
import { tool } from "ai";
import { z } from "zod";
import { getWritableTask, type RescheduleInput } from "@/lib/todoist";
import { groupForTask, targetForGroup } from "@/lib/domain/group-mapping";
import { uiPriorityToApi, type TaskLite } from "@/lib/todoist/types";
import { ScopeError } from "@/lib/errors";
import { makeStep, taskFingerprint } from "@/lib/ai/executor";
import type { ActionStep } from "@/lib/ai/pending-actions";
import { fmtDue, hhmm, isoDate, offHoursReason, type ToolCtx } from "../context";
import { proposeSteps } from "./propose";

const OFF_HOURS_HINT =
  "Wellbeing rule: don't schedule after 6 PM or on weekends unless the user explicitly asked. Pick a weekday daytime slot, or set allowOffHours=true only if they asked for it.";

async function resolveTask(tc: ToolCtx, id: string): Promise<TaskLite> {
  try {
    return await getWritableTask(tc.userId, id);
  } catch (err) {
    if (err instanceof ScopeError) {
      throw new ScopeError("That task isn't in one of the dashboard's groups. I can read it but not change it (this protects the rest of your Todoist).");
    }
    throw err;
  }
}

const q = (s: string) => `“${s}”`;

export function taskWriteTools(tc: ToolCtx) {
  const groupName = async (t: TaskLite) => groupForTask(t, await tc.groups())?.name ?? "its group";

  return {
    create_tasks: tool({
      description:
        "PROPOSE creating 1–10 Todoist tasks in one dashboard group (requires user confirmation). Prefer dueDate(+dueTime) over dueString. Priority 1 = most urgent (p1).",
      inputSchema: z.object({
        group: z.string().describe("Group slug"),
        tasks: z
          .array(
            z.object({
              title: z.string().trim().min(1).max(500),
              description: z.string().max(2000).optional(),
              dueDate: z.string().regex(isoDate).optional(),
              dueTime: z.string().regex(hhmm).optional().describe("HH:mm 24h, local time"),
              dueString: z.string().max(100).optional().describe("Natural language, only if no dueDate"),
              priority: z.number().int().min(1).max(4).optional(),
              next: z.boolean().optional().describe("Add the `next` label (becomes the group's next step)"),
              parentTaskId: z.string().optional(),
            }),
          )
          .min(1)
          .max(10),
        allowOffHours: z.boolean().optional().describe("Only when the user explicitly asked for evening/weekend"),
      }),
      execute: (input) =>
        proposeSteps(tc, async () => {
          const groups = await tc.groups();
          const g = groups.find((x) => x.slug === input.group && !x.archivedAt);
          if (!g) return { error: `No active group "${input.group}". Call list_groups for valid slugs.` };
          const target = targetForGroup(g);
          if (!target) return { error: `${g.name} isn't mapped to a Todoist project yet (Settings).` };
          if (input.tasks.filter((t) => t.next).length > 1) return { error: "Only one task per group can carry the `next` label." };
          const steps: ActionStep[] = [];
          for (const t of input.tasks) {
            if (!input.allowOffHours) {
              const why = offHoursReason(t.dueDate, t.dueTime, t.dueDate ? undefined : t.dueString);
              if (why) return { error: `${q(t.title)}: ${why}. ${OFF_HOURS_HINT}` };
            }
            if (t.parentTaskId) {
              const parent = await resolveTask(tc, t.parentTaskId);
              if (parent.projectId !== target.projectId) return { error: `Parent task ${q(parent.content)} is in a different group.` };
            }
            const dueString = t.dueDate ? (t.dueTime ? `${t.dueDate} ${t.dueTime}` : t.dueDate) : t.dueString;
            const due = t.dueDate ? fmtDue({ date: t.dueDate, time: t.dueTime }) : t.dueString ? fmtDue({ dueString: t.dueString }) : null;
            const bits = [due ? `due ${due}` : null, t.priority ? `p${t.priority}` : null, t.next ? "marked as next step" : null].filter(Boolean);
            steps.push(
              makeStep("create_task", `Add ${q(t.title)} to ${g.name}${bits.length ? `, ${bits.join(", ")}` : ""}`, {
                groupId: g.id,
                groupName: g.name,
                target,
                content: t.title,
                description: t.description,
                dueString,
                priority: t.priority ? uiPriorityToApi(t.priority as 1 | 2 | 3 | 4) : undefined,
                next: t.next,
                parentId: t.parentTaskId,
              }),
            );
          }
          return steps;
        }),
    }),

    update_task: tool({
      description:
        "PROPOSE editing a task's title, description, priority or labels, or marking it as the group's next step (requires confirmation). Due dates go through reschedule_tasks.",
      inputSchema: z.object({
        taskId: z.string(),
        title: z.string().trim().min(1).max(500).optional(),
        description: z.string().max(2000).optional(),
        priority: z.number().int().min(1).max(4).optional().describe("1 = p1 (most urgent)"),
        addLabels: z.array(z.string().min(1).max(60)).max(10).optional(),
        removeLabels: z.array(z.string().min(1).max(60)).max(10).optional(),
        markNext: z.boolean().optional().describe("true = add `next` (removes it from other tasks in the group); false = remove it"),
      }),
      execute: (input) =>
        proposeSteps(tc, async () => {
          const task = await resolveTask(tc, input.taskId);
          const changes: string[] = [];
          if (input.title !== undefined) changes.push(`rename to ${q(input.title)}`);
          if (input.description !== undefined) changes.push("update the description");
          if (input.priority !== undefined) changes.push(`set priority p${input.priority}`);
          if (input.addLabels?.length) changes.push(`add label${input.addLabels.length > 1 ? "s" : ""} ${input.addLabels.join(", ")}`);
          if (input.removeLabels?.length) changes.push(`remove ${input.removeLabels.join(", ")}`);
          if (input.markNext === true) changes.push("mark it as the next step");
          if (input.markNext === false) changes.push("unmark it as next step");
          if (changes.length === 0) return { error: "Nothing to change." };
          return [
            makeStep(
              "update_task",
              `Update ${q(task.content)} (${await groupName(task)}): ${changes.join(", ")}`,
              {
                taskId: task.id,
                content: input.title,
                description: input.description,
                priority: input.priority ? uiPriorityToApi(input.priority as 1 | 2 | 3 | 4) : undefined,
                addLabels: input.addLabels,
                removeLabels: input.removeLabels,
                setNext: input.markNext,
              },
              taskFingerprint(task),
            ),
          ];
        }),
    }),

    reschedule_tasks: tool({
      description:
        "PROPOSE new due dates for 1–20 tasks (requires confirmation). Recurring tasks keep their recurrence: only their next date moves, so give them a `date` (never a dueString or clear).",
      inputSchema: z.object({
        changes: z
          .array(
            z.object({
              taskId: z.string(),
              date: z.string().regex(isoDate).optional(),
              time: z.string().regex(hhmm).optional(),
              dueString: z.string().max(100).optional().describe("Natural language; not allowed for recurring tasks"),
              clearDue: z.boolean().optional(),
            }),
          )
          .min(1)
          .max(20),
        allowOffHours: z.boolean().optional(),
      }),
      execute: ({ changes, allowOffHours }) =>
        proposeSteps(tc, async () => {
          const steps: ActionStep[] = [];
          for (const c of changes) {
            const task = await resolveTask(tc, c.taskId);
            let change: RescheduleInput;
            if (c.date) change = { date: c.date, time: c.time ?? null };
            else if (c.clearDue) change = { clear: true };
            else if (c.dueString) change = { dueString: c.dueString };
            else return { error: `No new date for ${q(task.content)}.` };
            if (task.due?.isRecurring && !("date" in change)) {
              return {
                error: `${q(task.content)} repeats (${task.due.string}). I can only move its next occurrence to a specific date; changing or clearing the recurrence isn't allowed.`,
              };
            }
            if (!allowOffHours && "date" in change) {
              const why = offHoursReason(change.date, change.time);
              if (why) return { error: `${q(task.content)}: ${why}. ${OFF_HOURS_HINT}` };
            }
            if (!allowOffHours && "dueString" in change) {
              const why = offHoursReason(undefined, null, change.dueString);
              if (why) return { error: `${q(task.content)}: ${why}. ${OFF_HOURS_HINT}` };
            }
            const target = "date" in change ? fmtDue({ date: change.date, time: change.time }) : "clear" in change ? "no date" : fmtDue({ dueString: change.dueString });
            const keep = task.due?.isRecurring ? ` (keeps its “${task.due.string}” recurrence)` : "";
            steps.push(
              makeStep(
                "reschedule_task",
                "clear" in change ? `Remove the due date from ${q(task.content)}` : `Move ${q(task.content)} to ${target}${keep}`,
                { taskId: task.id, change },
                taskFingerprint(task),
              ),
            );
          }
          return steps;
        }),
    }),

    complete_tasks: tool({
      description: "PROPOSE completing 1–20 tasks (requires confirmation). This is also the answer to “delete this task” requests.",
      inputSchema: z.object({ taskIds: z.array(z.string()).min(1).max(20) }),
      execute: ({ taskIds }) =>
        proposeSteps(tc, async () => {
          const steps: ActionStep[] = [];
          for (const id of Array.from(new Set(taskIds))) {
            const task = await resolveTask(tc, id);
            const recurring = task.due?.isRecurring ? ` (recurring: the next “${task.due.string}” occurrence will appear)` : "";
            steps.push(makeStep("complete_task", `Complete ${q(task.content)} in ${await groupName(task)}${recurring}`, { taskId: task.id }, taskFingerprint(task)));
          }
          return steps;
        }),
    }),

    move_task: tool({
      description: "PROPOSE moving a task to another dashboard group (its project/section) (requires confirmation).",
      inputSchema: z.object({ taskId: z.string(), toGroup: z.string().describe("Destination group slug") }),
      execute: ({ taskId, toGroup }) =>
        proposeSteps(tc, async () => {
          const task = await resolveTask(tc, taskId);
          const groups = await tc.groups();
          const g = groups.find((x) => x.slug === toGroup && !x.archivedAt);
          if (!g) return { error: `No active group "${toGroup}".` };
          const target = targetForGroup(g);
          if (!target) return { error: `${g.name} isn't mapped to Todoist yet.` };
          const from = groupForTask(task, groups);
          if (from?.id === g.id) return { error: `${q(task.content)} is already in ${g.name}.` };
          return [makeStep("move_task", `Move ${q(task.content)} from ${from?.name ?? "its group"} to ${g.name}`, { taskId: task.id, target, groupName: g.name }, taskFingerprint(task))];
        }),
    }),
  };
}
