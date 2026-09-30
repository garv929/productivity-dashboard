import { TodoistApi, TodoistRequestError, type Task } from "@doist/todoist-sdk";
import type { CustomFetch, CustomFetchResponse } from "@doist/todoist-sdk";
import { NotFoundError, TodoistRateLimitError } from "@/lib/errors";
import type { TaskLite } from "./types";

const MAX_RETRIES = 2;
const MAX_WAIT_S = 10;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** fetch wrapper: honours HTTP 429 `Retry-After` with a couple of retries before surfacing it. */
export const fetchWithBackoff: CustomFetch = async (url, options) => {
  const { timeout, ...init } = options ?? {};
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      ...init,
      signal: init.signal ?? (timeout ? AbortSignal.timeout(timeout) : undefined),
    });
    if (res.status === 429 && attempt < MAX_RETRIES) {
      const retryAfter = Number(res.headers.get("retry-after")) || 2 ** attempt;
      await sleep(Math.min(retryAfter, MAX_WAIT_S) * 1000);
      continue;
    }
    if (res.status === 429) {
      throw new TodoistRateLimitError(Number(res.headers.get("retry-after")) || 5);
    }
    const wrapped: CustomFetchResponse = {
      ok: res.ok,
      status: res.status,
      statusText: res.statusText,
      headers: Object.fromEntries(res.headers.entries()),
      text: () => res.text(),
      json: () => res.json(),
      arrayBuffer: () => res.arrayBuffer(),
    };
    return wrapped;
  }
};

let client: TodoistApi | null = null;

export function todoistClient(): TodoistApi {
  const token = process.env.TODOIST_API_TOKEN;
  if (!token) throw new Error("TODOIST_API_TOKEN is not set");
  client ??= new TodoistApi(token, { customFetch: fetchWithBackoff });
  return client;
}

/** Normalises SDK errors into app errors (404 → NotFoundError, 429 → TodoistRateLimitError). */
export function mapTodoistError(err: unknown, what = "Todoist item"): never {
  if (err instanceof TodoistRateLimitError) throw err;
  if (err instanceof TodoistRequestError) {
    if (err.httpStatusCode === 429) throw new TodoistRateLimitError(5);
    if (err.httpStatusCode === 404) throw new NotFoundError(`${what} not found (it may have been completed or deleted).`);
  }
  const cause = (err as { cause?: unknown })?.cause;
  if (cause instanceof TodoistRateLimitError) throw cause;
  throw err;
}

export function toTaskLite(t: Task): TaskLite {
  return {
    id: t.id,
    content: t.content,
    description: t.description,
    projectId: t.projectId,
    sectionId: t.sectionId,
    parentId: t.parentId,
    labels: t.labels,
    priority: t.priority,
    due: t.due
      ? {
          date: t.due.date.slice(0, 10),
          datetime: t.due.datetime ?? null,
          string: t.due.string,
          isRecurring: t.due.isRecurring,
          timezone: t.due.timezone ?? null,
        }
      : null,
    durationMinutes: t.duration
      ? t.duration.unit === "minute"
        ? t.duration.amount
        : t.duration.amount * 8 * 60
      : null,
    childOrder: t.childOrder,
    url: t.url,
    completedAt: t.completedAt ? t.completedAt.toISOString() : null,
    checked: t.checked,
  };
}

/** Pages through a cursor-paginated SDK list endpoint. */
export async function collectAll<T>(
  page: (cursor: string | null) => Promise<{ results?: T[]; items?: T[]; nextCursor: string | null }>,
): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 50; i++) {
    const res = await page(cursor);
    out.push(...(res.results ?? res.items ?? []));
    if (!res.nextCursor) break;
    cursor = res.nextCursor;
  }
  return out;
}
