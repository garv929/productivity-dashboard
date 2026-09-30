import type { TaskLite } from "@/lib/todoist/types";

let seq = 0;

export function task(over: Partial<Omit<TaskLite, "due">> & { due?: TaskLite["due"] | string } = {}): TaskLite {
  seq++;
  const { due, ...rest } = over;
  return {
    id: `t${seq}`,
    content: `Task ${seq}`,
    description: "",
    projectId: "p1",
    sectionId: null,
    parentId: null,
    labels: [],
    priority: 1,
    due:
      typeof due === "string"
        ? { date: due.slice(0, 10), datetime: due.length > 10 ? due : null, string: due, isRecurring: false, timezone: null }
        : (due ?? null),
    durationMinutes: null,
    childOrder: seq,
    url: "",
    completedAt: null,
    checked: false,
    ...rest,
  };
}
