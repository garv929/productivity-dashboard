import { NEXT_LABEL, SKIP_LABEL_PREFIX, type TaskLite } from "@/lib/todoist/types";
import type { LocalDate } from "./time";

export type NextStepContext = {
  /** Today in the app timezone, `YYYY-MM-DD`. */
  today: LocalDate;
  /** Current instant; used to treat timed tasks earlier today as overdue. */
  now: Date;
};

export function hasNextLabel(t: TaskLite): boolean {
  return t.labels.includes(NEXT_LABEL);
}

export function isSkippedToday(t: TaskLite, today: LocalDate): boolean {
  return t.labels.includes(`${SKIP_LABEL_PREFIX}${today}`);
}

export function isOverdue(t: TaskLite, ctx: NextStepContext): boolean {
  if (!t.due) return false;
  if (t.due.date < ctx.today) return true;
  if (t.due.date === ctx.today && t.due.datetime) return new Date(t.due.datetime).getTime() < ctx.now.getTime();
  return false;
}

export function isDueToday(t: TaskLite, ctx: NextStepContext): boolean {
  return Boolean(t.due && t.due.date === ctx.today && !isOverdue(t, ctx));
}

function dueKey(t: TaskLite): string | null {
  if (!t.due) return null;
  return t.due.datetime ?? `${t.due.date}T99`;
}

function cmpDue(a: TaskLite, b: TaskLite): number {
  const ka = dueKey(a);
  const kb = dueKey(b);
  if (ka === kb) return 0;
  if (ka === null) return 1;
  if (kb === null) return -1;
  return ka < kb ? -1 : 1;
}

/**
 * Next-step order:
 * 1. `next` label (ties → child_order), 2. overdue (oldest first), 3. due today,
 * 4. priority p1→p4, 5. due date ascending (undated last), 6. child_order.
 */
export function compareForNextStep(a: TaskLite, b: TaskLite, ctx: NextStepContext): number {
  const an = hasNextLabel(a);
  const bn = hasNextLabel(b);
  if (an !== bn) return an ? -1 : 1;
  if (an && bn) return a.childOrder - b.childOrder;

  const ao = isOverdue(a, ctx);
  const bo = isOverdue(b, ctx);
  if (ao !== bo) return ao ? -1 : 1;
  if (ao && bo) {
    const c = cmpDue(a, b);
    if (c !== 0) return c;
  }

  const at = isDueToday(a, ctx);
  const bt = isDueToday(b, ctx);
  if (at !== bt) return at ? -1 : 1;

  if (a.priority !== b.priority) return b.priority - a.priority;

  const c = cmpDue(a, b);
  if (c !== 0) return c;

  return a.childOrder - b.childOrder;
}

/** Open top-level candidates in next-step order (skipped-today tasks excluded). */
export function rankNextSteps(tasks: TaskLite[], ctx: NextStepContext): TaskLite[] {
  return tasks
    .filter((t) => !t.checked && !t.parentId && !isSkippedToday(t, ctx.today))
    .sort((a, b) => compareForNextStep(a, b, ctx));
}

export function pickNextStep(tasks: TaskLite[], ctx: NextStepContext): TaskLite | null {
  return rankNextSteps(tasks, ctx)[0] ?? null;
}

export type TaskNode = TaskLite & { children: TaskNode[] };

/** All open tasks (including subtasks and skipped ones) as a tree, top level in next-step order. */
export function sortTaskTree(tasks: TaskLite[], ctx: NextStepContext): TaskNode[] {
  const ids = new Set(tasks.map((t) => t.id));
  const children = new Map<string, TaskLite[]>();
  for (const t of tasks) {
    if (t.parentId && ids.has(t.parentId)) {
      const list = children.get(t.parentId) ?? [];
      list.push(t);
      children.set(t.parentId, list);
    }
  }
  const build = (t: TaskLite): TaskNode => ({
    ...t,
    children: (children.get(t.id) ?? []).sort((a, b) => a.childOrder - b.childOrder).map(build),
  });
  const roots = tasks.filter((t) => !t.parentId || !ids.has(t.parentId));
  const skippedLast = (a: TaskLite, b: TaskLite) => {
    const as = isSkippedToday(a, ctx.today);
    const bs = isSkippedToday(b, ctx.today);
    if (as !== bs) return as ? 1 : -1;
    return compareForNextStep(a, b, ctx);
  };
  return roots.sort(skippedLast).map(build);
}

export type TaskCounts = { open: number; overdue: number; dueToday: number };

export function countTasks(tasks: TaskLite[], ctx: NextStepContext): TaskCounts {
  let overdue = 0;
  let dueToday = 0;
  for (const t of tasks) {
    if (isOverdue(t, ctx)) overdue++;
    else if (isDueToday(t, ctx)) dueToday++;
  }
  return { open: tasks.length, overdue, dueToday };
}
