import "server-only";
import { requireOwner, type Owner } from "@/lib/auth-guard";
import type { ActionResult } from "@/lib/action-result";
import { env } from "@/lib/env";
import type { ServiceCtx } from "@/lib/services/context";

const CODES: Record<string, string> = {
  TodoistRateLimitError: "rate_limited",
  ScopeError: "out_of_scope",
  NotFoundError: "not_found",
  ValidationError: "invalid",
  ZodError: "invalid",
  FocusLimitError: "focus_limit",
  CapExceededError: "cap_exceeded",
  GoogleAuthError: "google_auth",
  UnauthorizedError: "unauthorized",
};

/** Session re-check + error normalisation for every Server Action. */
export async function run<T>(fn: (ctx: ServiceCtx, owner: Owner) => Promise<T>): Promise<ActionResult<T>> {
  try {
    const owner = await requireOwner();
    const ctx: ServiceCtx = { userId: owner.userId, source: "ui", tz: env.APP_TIMEZONE };
    return { ok: true, data: await fn(ctx, owner) };
  } catch (err) {
    const e = err as { name?: string; message?: string; retryAfter?: number; issues?: { message: string }[] };
    const code = CODES[e?.name ?? ""];
    if (!code) console.error(err);
    const message =
      e?.name === "ZodError" && e.issues?.length
        ? e.issues.map((i) => i.message).join("; ")
        : code
          ? (e?.message ?? "Something went wrong")
          : "Something went wrong. Please try again.";
    return { ok: false, error: message, code, retryAfter: e?.retryAfter };
  }
}
