"use server";

import { z } from "zod";
import { run } from "./_run";
import {
  completeTask,
  createTask,
  getWritableTask,
  markNext,
  moveTask,
  rescheduleTask,
  skipForToday,
  unmarkNext,
  updateTask,
} from "@/lib/todoist";
import { listGroups, requireActiveGroup } from "@/lib/domain/groups";
import { groupForTask, targetForGroup } from "@/lib/domain/group-mapping";
import { localDate } from "@/lib/domain/time";
import { logActivity } from "@/lib/services/activity";
import { ValidationError } from "@/lib/errors";
import type { TaskLite } from "@/lib/todoist/types";

const id = z.string().min(1).max(64);

export async function addTaskAction(input: { slug: string; content: string; dueString?: string; priority?: number }) {
  return run(async (ctx): Promise<TaskLite> => {
    const data = z
      .object({
        slug: z.string().min(1),
        content: z.string().trim().min(1).max(500),
        dueString: z.string().trim().max(100).optional(),
        priority: z.number().int().min(1).max(4).optional(),
      })
      .parse(input);
    const group = await requireActiveGroup(ctx.userId, data.slug);
    const target = targetForGroup(group);
    if (!target) throw new ValidationError(`${group.name} isn't mapped to a Todoist project yet (Settings).`);
    return createTask(ctx.userId, target, {
      content: data.content,
      dueString: data.dueString || undefined,
      priority: data.priority,
    });
  });
}

export async function completeTaskAction(taskId: string) {
  return run(async (ctx) => {
    const task = await completeTask(ctx.userId, id.parse(taskId));
    const group = groupForTask(task, await listGroups(ctx.userId));
    await logActivity(ctx, { type: "task_completed", groupId: group?.id, refType: "todoist_task", refId: task.id });
    return { id: task.id };
  });
}

export async function updateTaskTitleAction(taskId: string, content: string) {
  return run(async (ctx) => updateTask(ctx.userId, id.parse(taskId), { content: z.string().trim().min(1).max(500).parse(content) }));
}

export async function setDueAction(taskId: string, dueString: string | null) {
  return run(async (ctx) => {
    const tid = id.parse(taskId);
    if (dueString === null || dueString.trim() === "") return rescheduleTask(ctx.userId, tid, { clear: true });
    const s = dueString.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return rescheduleTask(ctx.userId, tid, { date: s });
    return rescheduleTask(ctx.userId, tid, { dueString: s });
  });
}

export async function setPriorityAction(taskId: string, apiPriority: number) {
  return run(async (ctx) =>
    updateTask(ctx.userId, id.parse(taskId), { priority: z.number().int().min(1).max(4).parse(apiPriority) }),
  );
}

export async function toggleNextAction(taskId: string, on: boolean) {
  return run(async (ctx) => (on ? markNext(ctx.userId, id.parse(taskId)) : unmarkNext(ctx.userId, id.parse(taskId))));
}

export async function skipTaskAction(taskId: string) {
  return run(async (ctx) => skipForToday(ctx.userId, id.parse(taskId), localDate(new Date(), ctx.tz)));
}

export async function moveTaskAction(taskId: string, toSlug: string) {
  return run(async (ctx) => {
    const group = await requireActiveGroup(ctx.userId, toSlug);
    const target = targetForGroup(group);
    if (!target) throw new ValidationError(`${group.name} isn't mapped to Todoist yet.`);
    await getWritableTask(ctx.userId, id.parse(taskId));
    return moveTask(ctx.userId, taskId, target);
  });
}
