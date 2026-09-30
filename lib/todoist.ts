import "server-only";
import { revalidateTag, unstable_cache } from "next/cache";
import { createCommand, type AddTaskArgs } from "@doist/todoist-sdk";
import { collectAll, mapTodoistError, todoistClient, toTaskLite } from "@/lib/todoist/client";
import {
  NEXT_LABEL,
  SKIP_LABEL_PREFIX,
  type ProjectLite,
  type SectionLite,
  type TaskLite,
} from "@/lib/todoist/types";
import { listGroups } from "@/lib/domain/groups";
import { groupForTask, isWritableLocation, type TodoistTarget } from "@/lib/domain/group-mapping";
import { ScopeError, ValidationError } from "@/lib/errors";

export const TODOIST_TAG = "todoist";

/* ------------------------------------------------------------------ Reads */

/** Every open task in the account, in one paginated call; grouped in memory by callers. */
export const listOpenTasks = unstable_cache(
  async (): Promise<TaskLite[]> => {
    try {
      const api = todoistClient();
      const tasks = await collectAll((cursor) => api.getTasks({ cursor, limit: 200 }));
      return tasks.map(toTaskLite);
    } catch (err) {
      mapTodoistError(err);
    }
  },
  ["todoist:open-tasks"],
  { tags: [TODOIST_TAG], revalidate: 30 },
);

export const listProjects = unstable_cache(
  async (): Promise<ProjectLite[]> => {
    try {
      const api = todoistClient();
      const projects = await collectAll((cursor) => api.getProjects({ cursor, limit: 200 }));
      return projects.map((p) => ({
        id: p.id,
        name: p.name,
        parentId: "parentId" in p ? (p.parentId ?? null) : null,
        isInbox: "inboxProject" in p ? Boolean(p.inboxProject) : false,
      }));
    } catch (err) {
      mapTodoistError(err);
    }
  },
  ["todoist:projects"],
  { tags: [TODOIST_TAG], revalidate: 300 },
);

export const listSections = unstable_cache(
  async (): Promise<SectionLite[]> => {
    try {
      const api = todoistClient();
      const sections = await collectAll((cursor) => api.getSections({ cursor, limit: 200 }));
      return sections.map((s) => ({ id: s.id, name: s.name, projectId: s.projectId }));
    } catch (err) {
      mapTodoistError(err);
    }
  },
  ["todoist:sections"],
  { tags: [TODOIST_TAG], revalidate: 300 },
);

/** Tasks completed in [since, until). ISO-8601 instants. */
export const listCompletedTasks = unstable_cache(
  async (since: string, until: string): Promise<TaskLite[]> => {
    try {
      const api = todoistClient();
      const tasks = await collectAll((cursor) =>
        api.getCompletedTasksByCompletionDate({ since, until, cursor, limit: 200 }),
      );
      return tasks.map(toTaskLite);
    } catch (err) {
      mapTodoistError(err);
    }
  },
  ["todoist:completed"],
  { tags: [TODOIST_TAG], revalidate: 30 },
);

/** Uncached single-task read, used to re-validate before writes. Throws NotFoundError when gone/completed. */
export async function getTaskFresh(id: string): Promise<TaskLite> {
  try {
    const task = toTaskLite(await todoistClient().getTask(id));
    if (task.checked) throw new ValidationError("That task is already completed.");
    return task;
  } catch (err) {
    if (err instanceof ValidationError) throw err;
    mapTodoistError(err, "Task");
  }
}

export function revalidateTodoist() {
  revalidateTag(TODOIST_TAG, { expire: 0 });
}

/* ----------------------------------------------------- Write allowlist */

async function assertWritable(userId: string, location: { projectId: string; sectionId: string | null }) {
  const groups = await listGroups(userId);
  if (!isWritableLocation(location, groups)) throw new ScopeError();
}

/** Fetches the task fresh and asserts it lives in an active group's project/section. */
export async function getWritableTask(userId: string, id: string): Promise<TaskLite> {
  const task = await getTaskFresh(id);
  await assertWritable(userId, task);
  return task;
}

async function write<T>(fn: () => Promise<T>, what = "Task"): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    mapTodoistError(err, what);
  } finally {
    revalidateTodoist();
  }
}

/* ----------------------------------------------------------------- Writes */

export type CreateTaskInput = {
  content: string;
  description?: string;
  dueString?: string;
  priority?: number;
  labels?: string[];
  parentId?: string;
  durationMinutes?: number;
};

export async function createTask(userId: string, target: TodoistTarget, input: CreateTaskInput): Promise<TaskLite> {
  await assertWritable(userId, target);
  if (input.parentId) {
    const parent = await getTaskFresh(input.parentId);
    if (parent.projectId !== target.projectId) throw new ValidationError("Parent task is in a different group.");
  }
  const args: AddTaskArgs = {
    content: input.content,
    description: input.description,
    projectId: target.projectId,
    ...(target.sectionId && !input.parentId ? { sectionId: target.sectionId } : {}),
    ...(input.parentId ? { parentId: input.parentId } : {}),
    ...(input.dueString ? { dueString: input.dueString } : {}),
    ...(input.priority ? { priority: input.priority } : {}),
    ...(input.labels?.length ? { labels: input.labels } : {}),
  };
  const withDuration: AddTaskArgs = input.durationMinutes
    ? { ...args, duration: input.durationMinutes, durationUnit: "minute" }
    : args;
  return write(async () => toTaskLite(await todoistClient().addTask(withDuration)));
}

export type UpdateTaskInput = {
  content?: string;
  description?: string;
  priority?: number;
  labels?: string[];
};

export async function updateTask(userId: string, id: string, input: UpdateTaskInput): Promise<TaskLite> {
  await getWritableTask(userId, id);
  return write(async () => toTaskLite(await todoistClient().updateTask(id, input)));
}

export type RescheduleInput =
  | { date: string; time?: string | null }
  | { dueString: string }
  | { clear: true };

/**
 * Reschedule with recurrence preserved: for recurring tasks only the date moves (Sync
 * `item_update` with the original `string` + `is_recurring`); the due string is never overwritten.
 */
export async function rescheduleTask(userId: string, id: string, input: RescheduleInput): Promise<TaskLite> {
  const task = await getWritableTask(userId, id);
  const api = todoistClient();

  if (task.due?.isRecurring) {
    if (!("date" in input)) {
      throw new ValidationError(
        `"${task.content}" is recurring (${task.due.string}); only its next date can be moved, not its recurrence.`,
      );
    }
    const date = input.time ? `${input.date}T${input.time}:00` : input.date;
    return write(async () => {
      await api.sync({
        commands: [
          createCommand("item_update", {
            id,
            due: {
              date,
              string: task.due!.string,
              isRecurring: true,
              ...(task.due!.timezone ? { timezone: task.due!.timezone } : {}),
            },
          }),
        ],
      });
      return toTaskLite(await api.getTask(id));
    });
  }

  return write(async () => {
    if ("clear" in input) return toTaskLite(await api.updateTask(id, { dueString: null }));
    if ("dueString" in input) return toTaskLite(await api.updateTask(id, { dueString: input.dueString }));
    const args = input.time
      ? { dueDatetime: `${input.date}T${input.time}:00` }
      : { dueDate: input.date };
    return toTaskLite(await api.updateTask(id, args));
  });
}

export async function completeTask(userId: string, id: string): Promise<TaskLite> {
  const task = await getWritableTask(userId, id);
  await write(() => todoistClient().closeTask(id));
  return task;
}

/** Undo for a completion performed by the app (location was verified before completing). */
export async function reopenTask(id: string): Promise<void> {
  await write(() => todoistClient().reopenTask(id));
}

export async function moveTask(userId: string, id: string, target: TodoistTarget): Promise<TaskLite> {
  await getWritableTask(userId, id);
  await assertWritable(userId, target);
  return write(async () => {
    const api = todoistClient();
    const moved = target.sectionId
      ? await api.moveTask(id, { sectionId: target.sectionId })
      : await api.moveTask(id, { projectId: target.projectId });
    return toTaskLite(moved);
  });
}

/** Adds `next` to one task and removes it from every other open task in the same group. */
export async function markNext(userId: string, id: string): Promise<TaskLite> {
  const task = await getWritableTask(userId, id);
  const groups = await listGroups(userId);
  const group = groupForTask(task, groups);
  const others = (await listOpenTasks()).filter(
    (t) => t.id !== id && t.labels.includes(NEXT_LABEL) && group && groupForTask(t, groups)?.id === group.id,
  );
  return write(async () => {
    const api = todoistClient();
    await Promise.all(
      others.map((t) => api.updateTask(t.id, { labels: t.labels.filter((l) => l !== NEXT_LABEL) })),
    );
    const labels = Array.from(new Set([...task.labels, NEXT_LABEL]));
    return toTaskLite(await api.updateTask(id, { labels }));
  });
}

export async function unmarkNext(userId: string, id: string): Promise<TaskLite> {
  const task = await getWritableTask(userId, id);
  return write(async () =>
    toTaskLite(await todoistClient().updateTask(id, { labels: task.labels.filter((l) => l !== NEXT_LABEL) })),
  );
}

/** `skip:<YYYY-MM-DD>` hides the task from the next-step algorithm for that day only. */
export async function skipForToday(userId: string, id: string, today: string): Promise<TaskLite> {
  const task = await getWritableTask(userId, id);
  const labels = [...task.labels.filter((l) => !l.startsWith(SKIP_LABEL_PREFIX)), `${SKIP_LABEL_PREFIX}${today}`];
  return write(async () => toTaskLite(await todoistClient().updateTask(id, { labels })));
}

/**
 * The only task deletion in the app: rolling back a task created earlier in the same
 * assistant operation. Callers must pass an id they created in that operation.
 */
export async function rollbackCreatedTask(id: string): Promise<void> {
  await write(() => todoistClient().deleteTask(id));
}

export async function todoistHealthy(): Promise<boolean> {
  try {
    await todoistClient().getUser();
    return true;
  } catch {
    return false;
  }
}
