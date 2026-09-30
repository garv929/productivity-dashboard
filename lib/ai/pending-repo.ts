import "server-only";
import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { pendingActions, type PendingAction } from "@/lib/db/schema";
import type { ActionStep, ExecutionResult, PendingRecord, PendingRepo } from "./pending-actions";

function toRecord(row: PendingAction): PendingRecord {
  const input = row.input as { steps?: ActionStep[] } | null;
  return {
    id: row.id,
    userId: row.userId,
    chatSessionId: row.chatSessionId,
    turnId: row.turnId,
    status: row.status,
    steps: input?.steps ?? [],
    result: (row.result as ExecutionResult | null) ?? null,
    error: row.error,
    undone: row.undone,
    expiresAt: row.expiresAt,
  };
}

const previewOf = (steps: ActionStep[]) => ({ steps: steps.map((s) => ({ tool: s.tool, summary: s.summary })) });
const toolNameOf = (steps: ActionStep[]) => Array.from(new Set(steps.map((s) => s.tool))).join("+").slice(0, 200);

export const pendingRepo: PendingRepo = {
  async create({ userId, chatSessionId, turnId, steps, expiresAt }) {
    const [row] = await db
      .insert(pendingActions)
      .values({ userId, chatSessionId, turnId, toolName: toolNameOf(steps), input: { steps }, preview: previewOf(steps), expiresAt })
      .returning();
    return toRecord(row);
  },

  async get(id, userId) {
    const [row] = await db
      .select()
      .from(pendingActions)
      .where(and(eq(pendingActions.id, id), eq(pendingActions.userId, userId)))
      .limit(1);
    return row ? toRecord(row) : null;
  },

  async append(id, userId, steps, expiresAt) {
    return db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(pendingActions)
        .where(and(eq(pendingActions.id, id), eq(pendingActions.userId, userId), eq(pendingActions.status, "awaiting_confirmation")))
        .for("update")
        .limit(1);
      if (!row) return null;
      const all = [...((row.input as { steps?: ActionStep[] }).steps ?? []), ...steps];
      const [updated] = await tx
        .update(pendingActions)
        .set({ input: { steps: all }, preview: previewOf(all), toolName: toolNameOf(all), expiresAt })
        .where(eq(pendingActions.id, id))
        .returning();
      return toRecord(updated);
    });
  },

  async claim(id, userId, now) {
    const [row] = await db
      .update(pendingActions)
      .set({ status: "executing" })
      .where(
        and(
          eq(pendingActions.id, id),
          eq(pendingActions.userId, userId),
          eq(pendingActions.status, "awaiting_confirmation"),
          gt(pendingActions.expiresAt, now),
        ),
      )
      .returning();
    return row ? toRecord(row) : null;
  },

  async transition(id, userId, from, patch) {
    const rows = await db
      .update(pendingActions)
      .set({
        ...(patch.status && { status: patch.status }),
        ...(patch.result !== undefined && { result: patch.result }),
        ...(patch.error !== undefined && { error: patch.error }),
        ...(patch.undone !== undefined && { undone: patch.undone }),
        ...(patch.executedAt && { executedAt: patch.executedAt }),
      })
      .where(and(eq(pendingActions.id, id), eq(pendingActions.userId, userId), eq(pendingActions.status, from)))
      .returning({ id: pendingActions.id });
    return rows.length > 0;
  },

  async markUndone(id, userId) {
    const rows = await db
      .update(pendingActions)
      .set({ undone: true })
      .where(and(eq(pendingActions.id, id), eq(pendingActions.userId, userId), eq(pendingActions.undone, false)))
      .returning({ id: pendingActions.id });
    return rows.length > 0;
  },
};

/** Recent actions in a chat, so the model knows what the user confirmed or cancelled via the UI. */
export async function recentActionsForSession(userId: string, chatSessionId: string, limit = 6): Promise<PendingRecord[]> {
  const rows = await db
    .select()
    .from(pendingActions)
    .where(and(eq(pendingActions.userId, userId), eq(pendingActions.chatSessionId, chatSessionId)))
    .orderBy(sql`${pendingActions.createdAt} desc`)
    .limit(limit);
  return rows.map(toRecord);
}
