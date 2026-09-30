"use client";

import { toast } from "sonner";
import type { ActionResult } from "@/lib/action-result";

export class FetchError extends Error {
  constructor(
    message: string,
    public status: number,
    public retryAfter?: number,
  ) {
    super(message);
  }
}

export const RATE_LIMIT_TOAST = "Todoist is rate-limiting, retrying…";

export function showRateLimitToast() {
  toast.warning(RATE_LIMIT_TOAST, { id: "todoist-rate-limit", duration: 6000 });
}

export async function fetcher<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (res.status === 401) {
    // Full reload on purpose: drops all client state after the session ends.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = "/login";
    throw new FetchError("Signed out", 401);
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string; retryAfter?: number };
    if (res.status === 429) showRateLimitToast();
    throw new FetchError(body.message ?? res.statusText, res.status, body.retryAfter);
  }
  return res.json() as Promise<T>;
}

/** Unwraps a Server Action result, toasting failures (rate limits get the non-blocking toast). */
export function unwrap<T>(result: ActionResult<T>, opts: { silent?: boolean } = {}): T {
  if (result.ok) return result.data;
  if (result.code === "rate_limited") showRateLimitToast();
  else if (!opts.silent) toast.error(result.error);
  const err = new Error(result.error) as Error & { code?: string };
  err.code = result.code;
  throw err;
}
