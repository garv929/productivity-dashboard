/** Compact, serialisable task shape used across the app (never persisted). */
export type TaskLite = {
  id: string;
  content: string;
  description: string;
  projectId: string;
  sectionId: string | null;
  parentId: string | null;
  labels: string[];
  /** Todoist API priority: 4 = p1 (urgent) … 1 = p4 (normal). */
  priority: number;
  due: {
    date: string;
    datetime: string | null;
    string: string;
    isRecurring: boolean;
    timezone: string | null;
  } | null;
  durationMinutes: number | null;
  childOrder: number;
  url: string;
  completedAt: string | null;
  checked: boolean;
};

export type ProjectLite = { id: string; name: string; parentId: string | null; isInbox: boolean };
export type SectionLite = { id: string; name: string; projectId: string };

export const NEXT_LABEL = "next";
export const SKIP_LABEL_PREFIX = "skip:";

/** Todoist API priority (4..1) → UI label p1..p4. */
export function priorityLabel(apiPriority: number): "p1" | "p2" | "p3" | "p4" {
  return (["p4", "p3", "p2", "p1"] as const)[Math.min(Math.max(apiPriority, 1), 4) - 1];
}

export function uiPriorityToApi(p: 1 | 2 | 3 | 4): number {
  return 5 - p;
}
