import "server-only";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { focusItems, type FocusItem, type FocusStatus } from "@/lib/db/schema";
import { FocusLimitError, NotFoundError, ValidationError } from "@/lib/errors";
import type { ServiceCtx } from "./context";

export const FOCUS_ACTIVE_LIMIT = 2;
export const FOCUS_STATUSES: FocusStatus[] = ["active", "paused", "done", "dropped"];
export const FOCUS_STATUS_LABEL: Record<FocusStatus, string> = {
  active: "Active",
  paused: "Paused",
  done: "Done",
  dropped: "Dropped",
};

export async function listFocusItems(userId: string): Promise<FocusItem[]> {
  return db
    .select()
    .from(focusItems)
    .where(eq(focusItems.userId, userId))
    .orderBy(sql`case ${focusItems.status} when 'active' then 0 when 'paused' then 1 when 'done' then 2 else 3 end`, asc(focusItems.createdAt));
}

function isLimitViolation(err: unknown): boolean {
  const e = err as { message?: string; cause?: { message?: string } };
  return /FOCUS_LIMIT/.test(e?.message ?? "") || /FOCUS_LIMIT/.test(e?.cause?.message ?? "");
}

/**
 * Changes status inside a transaction holding a per-user advisory lock, so two concurrent
 * activations can't both pass the ≤ 2 active check (the DB trigger is a second backstop).
 */
export async function setFocusStatus(ctx: ServiceCtx, id: string, status: FocusStatus): Promise<{ item: FocusItem; previousStatus: FocusStatus }> {
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"focus_items:" + ctx.userId}))`);
      const [item] = await tx
        .select()
        .from(focusItems)
        .where(and(eq(focusItems.userId, ctx.userId), eq(focusItems.id, id)));
      if (!item) throw new NotFoundError("Focus item not found.");
      if (status === "active" && item.status !== "active") {
        const [{ count }] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(focusItems)
          .where(and(eq(focusItems.userId, ctx.userId), eq(focusItems.status, "active"), ne(focusItems.id, id)));
        if (count >= FOCUS_ACTIVE_LIMIT) throw new FocusLimitError();
      }
      const [updated] = await tx.update(focusItems).set({ status }).where(eq(focusItems.id, id)).returning();
      return { item: updated, previousStatus: item.status };
    });
  } catch (err) {
    if (isLimitViolation(err)) throw new FocusLimitError();
    throw err;
  }
}

export type UpsertFocusInput = { id?: string; title?: string; goal?: string | null; link?: string | null };

/** Creates new items as `paused`; use setFocusStatus to activate. */
export async function upsertFocusItem(ctx: ServiceCtx, input: UpsertFocusInput): Promise<FocusItem> {
  const values = Object.fromEntries(Object.entries(input).filter(([k, v]) => k !== "id" && v !== undefined));
  if (input.id) {
    const [row] = await db
      .update(focusItems)
      .set(values)
      .where(and(eq(focusItems.userId, ctx.userId), eq(focusItems.id, input.id)))
      .returning();
    if (!row) throw new NotFoundError("Focus item not found.");
    return row;
  }
  if (!input.title) throw new ValidationError("A focus item needs a title.");
  const [row] = await db
    .insert(focusItems)
    .values({ userId: ctx.userId, title: input.title, ...values, status: "paused" })
    .returning();
  return row;
}
