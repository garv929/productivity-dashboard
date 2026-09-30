import "server-only";
import { and, eq, gte, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { activityLog, type Activity, type ActivityType } from "@/lib/db/schema";
import { getGroupByKind } from "@/lib/domain/groups";
import { nowOf, type ServiceCtx } from "./context";

export type LogActivityInput = {
  type: ActivityType;
  groupId?: string | null;
  groupKind?: "pipeline" | "people" | "prep" | "research" | "options" | "focus";
  value?: number;
  refType?: string;
  refId?: string;
  occurredAt?: Date;
};

export async function logActivity(ctx: ServiceCtx, input: LogActivityInput): Promise<Activity> {
  let groupId = input.groupId ?? null;
  if (!groupId && input.groupKind) groupId = (await getGroupByKind(ctx.userId, input.groupKind))?.id ?? null;
  const [row] = await db
    .insert(activityLog)
    .values({
      userId: ctx.userId,
      groupId,
      type: input.type,
      value: input.value ?? 1,
      refType: input.refType,
      refId: input.refId,
      occurredAt: input.occurredAt ?? nowOf(ctx),
      source: ctx.source,
    })
    .returning();
  return row;
}

/** Reversal of an activity this app just logged (compound-operation undo only). */
export async function removeActivity(userId: string, id: string): Promise<void> {
  await db.delete(activityLog).where(and(eq(activityLog.userId, userId), eq(activityLog.id, id)));
}

export async function listActivity(userId: string, from: Date, to: Date): Promise<Activity[]> {
  return db
    .select()
    .from(activityLog)
    .where(and(eq(activityLog.userId, userId), gte(activityLog.occurredAt, from), lt(activityLog.occurredAt, to)));
}
