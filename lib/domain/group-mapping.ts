import type { TaskLite } from "@/lib/todoist/types";

export type TodoistTarget = { projectId: string; sectionId: string | null };

export type MappableGroup = {
  id: string;
  slug: string;
  todoistProjectId: string | null;
  todoistSectionId: string | null;
  archivedAt: Date | string | null;
};

/**
 * Which group owns a task: a section mapping beats a whole-project mapping.
 * Only active (non-archived) groups are considered.
 */
export function groupForTask<G extends MappableGroup>(
  task: Pick<TaskLite, "projectId" | "sectionId">,
  groups: G[],
): G | null {
  const active = groups.filter((g) => !g.archivedAt && g.todoistProjectId);
  const bySection = active.find(
    (g) => g.todoistSectionId && g.todoistProjectId === task.projectId && g.todoistSectionId === task.sectionId,
  );
  if (bySection) return bySection;
  return active.find((g) => !g.todoistSectionId && g.todoistProjectId === task.projectId) ?? null;
}

export function isWritableLocation(
  location: { projectId: string; sectionId: string | null },
  groups: MappableGroup[],
): boolean {
  return groupForTask(location, groups) !== null;
}

export function targetForGroup(group: MappableGroup): TodoistTarget | null {
  if (!group.todoistProjectId) return null;
  return { projectId: group.todoistProjectId, sectionId: group.todoistSectionId };
}

export function tasksByGroup<G extends MappableGroup>(tasks: TaskLite[], groups: G[]): Map<string, TaskLite[]> {
  const out = new Map<string, TaskLite[]>();
  for (const g of groups) out.set(g.id, []);
  for (const t of tasks) {
    const g = groupForTask(t, groups);
    if (g) out.get(g.id)!.push(t);
  }
  return out;
}
