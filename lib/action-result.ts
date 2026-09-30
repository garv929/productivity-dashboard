export type ActionResult<T = null> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string; retryAfter?: number };

export function isRateLimited(r: ActionResult<unknown>): boolean {
  return !r.ok && r.code === "rate_limited";
}
